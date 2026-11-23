/** Canonical availability, civil-day display and retained preview hours. */
import { refreshCanonicalOpening } from "./map-data.js";
import { chipList, sourceName } from "./map-details.js";
import { refresh } from "./map-filters.js";
import { context, runtime, state } from "./map-state.js";
import { escapeHtml, t } from "./map-utils.js";

export function listOpeningStatus(poi) {
  if (poi.raw?.canonical_opening) {
    const status=sourceOpeningStatus(poi.raw.hours_display);
    return {isOpen:["open","closing"].includes(status.kind),label:status.label,detail:status.note};
  }
  if (poi.raw?.data_status === "unreviewed_source_preview") {
    return { isOpen: null, label: "Da verificare", detail: `Orari originali ${sourceName(poi)}, non revisionati` };
  }
  const status = currentOpeningStatus(buildWeeklySchedule(poi.hours || []), new Date());
  return {
    ...status,
    label: status.isOpen ? t("map.open", {}, "Aperto") : t("map.closed", {}, "Chiuso"),
  };
}

/**
 * Service sheet (layout r3, 2026-11-15): a fixed header with what matters first, anchors
 * to four sections on one scrolling page, a fixed call/directions bar, and the single
 * reliability panel at the end ("Fonti e aggiornamenti"). See .scratch/card-layout/plan.md.
 */

export function todayHours(display, now=new Date()) {
  const structured=display?.days?.some(d=>d.intervals?.length);
  if (!structured) return display?.raw_text || display?.scoped?.length ? "Orari indicati come testo" : "";
  const day=new Intl.DateTimeFormat("en-GB",{timeZone:context.profile?.timezone || "UTC",weekday:"short"}).format(now);
  const key=["lun","mar","mer","gio","ven","sab","dom"][["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(day)];
  const today=display.days.find(d=>d.day===key);
  return today?.intervals?.length ? `Oggi ${today.intervals.map(i=>i.label).join(", ")}` : "";  // closed today: the status says it
}

/** Hours that deserve the separate amber flag: corrections, conflicts, review notes. */

export function hoursNeedReview(display) {
  if (!display) return false;
  return Boolean((display.warnings || []).length || (display.days || []).some(d=>d.issues?.length || d.intervals?.some(i=>i.review_note)));
}

export function renderCourseHours(raw) {
  const display=raw.hours_display;
  const enrol=raw.enrolment;
  const enrolState=enrol?.state==="aperte" ? "Iscrizioni aperte" : enrol?.state==="chiuse" ? "Iscrizioni chiuse" : "";
  // Week table like the other cards (r2): each lesson time with its levels as labels.
  const week=display.kind==="lessons" ? `<div class="source-week lesson-week">${display.days.map(day=>`<div class="source-day"><strong>${escapeHtml(day.label)}</strong><span>${day.intervals.length ? day.intervals.map(v=>`<span class="lesson-slot"><span>${escapeHtml(v.label)}</span>${(v.levels || []).map(l=>`<span class="level-chip">${escapeHtml(l)}</span>`).join("")}</span>`).join("") : '<span class="unknown-value">Nessuna lezione</span>'}</span></div>`).join("")}</div>` : "";
  const notes=(display.courses || []).filter(c=>c.note || c.flags.length || !c.sessions.length).map(c=>`<li><span class="level-chip">${escapeHtml(c.level)}</span> ${escapeHtml([c.note, ...c.flags, c.sessions.length ? "" : "orario non indicato"].filter(Boolean).join(" · "))}</li>`).join("");
  return `${week ? `<h4>Orari delle lezioni</h4>${week}` : ""}${notes ? `<h4>Note dei corsi</h4><ul class="course-notes">${notes}</ul>` : ""}
    ${display.kind==="office" && display.cpia ? "<p>Iscrizioni e informazioni in segreteria.</p>" : ""}
    ${display.office_text ? `<h4>${display.cpia ? "Orari di ricevimento" : "Segreteria"}</h4><p class="source-hours-text">${escapeHtml(display.office_text)}</p>` : ""}
    ${display.kind==="none" ? `<p>${escapeHtml(display.status_label)}.</p>` : ""}
    ${enrolState || enrol?.start_text ? `<h4>Iscrizioni</h4>${enrolState ? `<p><strong>${escapeHtml(enrolState)}</strong>${enrol.text ? ` — <span class="source-hours-text">${escapeHtml(enrol.text)}</span>` : ""}</p>` : ""}${enrol?.start_text ? `<p>${escapeHtml(enrol.start_text)}</p>` : ""}` : ""}
    ${raw.summer_closure ? '<p class="source-note">La sede indica una chiusura estiva.</p>' : ""}
    <p class="service-advice">Contatta la sede prima di andare: iscrizioni, posti e date vanno verificati.</p>`;
}

export function renderHoursSection(poi) {
  if (poi.raw?.data_status === "approved_canonical_local") return renderCanonicalHours(poi);
  const raw=poi.raw || {};
  const display=raw.hours_display;
  if (["lessons","office","none"].includes(display?.kind)) return `<section class="detail-section service-section" id="sec-orari"><h3>Orari</h3>${renderCourseHours(raw)}</section>`;
  const known=Boolean(display?.days?.some(d=>d.intervals?.length) || display?.raw_text || display?.scoped?.length);
  const meals=(raw.meal_times || []).map(m=>m.label);
  const status=sourceOpeningStatus(display);
  const quiet=display ? {...display, note: ""} : display;
  return `<section class="detail-section service-section" id="sec-orari"><h3>Orari</h3>
    ${known ? renderSourceHours(quiet) : "<p>La fonte non indica orari.</p>"}
    ${meals.length ? `<h4>Pasti</h4>${chipList(meals)}` : ""}
    ${!known || hoursNeedReview(display) || status.kind==="unknown" ? '<p class="service-advice">Chiama prima di andare: gli orari potrebbero non essere aggiornati.</p>' : ""}
  </section>`;
}

export function renderHours(hours) {
  const schedule = buildWeeklySchedule(hours);
  const now = new Date();
  const today = isoWeekday(now);
  const status = currentOpeningStatus(schedule, now);
  const isCollapsed = !status.isOpen;
  const statusTag = isCollapsed ? "button" : "div";
  const statusAttributes = isCollapsed
    ? ' type="button" data-hours-toggle aria-expanded="false" aria-controls="detail-hours-table"'
    : "";
  return `
    <${statusTag} class="hours-status ${status.isOpen ? "open" : "closed"}${isCollapsed ? " interactive" : ""}"${statusAttributes}>
      <span class="hours-status-dot" aria-hidden="true"></span>
      <span class="hours-status-copy">
        <strong>${escapeHtml(status.label)}</strong>
        <span>${escapeHtml(status.detail)}</span>
      </span>
      ${isCollapsed ? `
        <span class="hours-toggle-label">
          <span data-hours-toggle-label>${escapeHtml(t("map.show_hours", {}, "Mostra orari"))}</span>
          <span class="hours-toggle-chevron" aria-hidden="true">⌄</span>
        </span>
      ` : ""}
    </${statusTag}>
    <div class="hours-table${isCollapsed ? " collapsed" : ""}" id="detail-hours-table">
      ${[1, 2, 3, 4, 5, 6, 7].map((weekday) => {
        const ranges = schedule.get(weekday) || [];
        const isToday = weekday === today;
        return `
          <div class="hours-row${isToday ? " today" : ""}">
            <div class="hours-day">
              <span>${escapeHtml(weekdayFullLabel(weekday))}</span>
              ${isToday ? `<span class="hours-today-tag">${escapeHtml(t("map.today", {}, "Oggi"))}</span>` : ""}
            </div>
            <div class="hours-time${ranges.length ? "" : " closed"}">
              ${ranges.length ? ranges.map(formatHourRange).join('<span class="hours-range-separator">/</span>') : escapeHtml(t("map.closed", {}, "Closed"))}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

export function bindHoursToggle() {
  const toggle = document.querySelector("[data-hours-toggle]");
  const table = document.getElementById("detail-hours-table");
  const label = document.querySelector("[data-hours-toggle-label]");
  if (!toggle || !table) return;

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    table.classList.toggle("collapsed", expanded);
    if (label) {
      label.textContent = expanded
        ? t("map.show_hours", {}, "Mostra orari")
        : t("map.hide_hours", {}, "Nascondi orari");
    }
  }, {signal: runtime.lifecycle?.signal});
}

export function buildWeeklySchedule(hours) {
  const schedule = new Map([1, 2, 3, 4, 5, 6, 7].map((weekday) => [weekday, []]));
  (hours || []).forEach((hour) => {
    const weekday = Number(hour.weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return;

    const range = hour.is_24h
      ? { weekday, is24h: true, opensMinutes: 0, closesMinutes: 1440, note: hour.note || "" }
      : hourRangeFromRecord(hour, weekday);
    if (!range) return;
    schedule.get(weekday).push(range);
  });

  schedule.forEach((ranges) => {
    ranges.sort((a, b) => a.opensMinutes - b.opensMinutes);
  });
  return schedule;
}

export function hourRangeFromRecord(hour, weekday) {
  const opensMinutes = parseClockMinutes(hour.opens_at);
  const closesMinutes = parseClockMinutes(hour.closes_at);
  if (opensMinutes == null || closesMinutes == null) return null;
  return {
    weekday,
    is24h: false,
    opensMinutes,
    closesMinutes,
    note: hour.note || "",
  };
}

export function currentOpeningStatus(schedule, now) {
  const nowMinute = weekMinute(now);
  const intervals = mergedOpeningIntervals(schedule);
  if (!intervals.length) {
    return {
      isOpen: false,
      label: t("map.closed_now", {}, "Chiuso ora"),
      detail: t("map.no_opening_records", {}, "Nessuna apertura registrata."),
    };
  }

  const current = intervals.find((interval) => nowMinute >= interval.start && nowMinute < interval.end);
  if (current) {
    if (current.end - current.start >= 7 * 24 * 60) {
      return {
        isOpen: true,
        label: t("map.open_now", {}, "Aperto ora"),
        detail: t("map.open_24h", {}, "24h"),
      };
    }
    return {
      isOpen: true,
      label: t("map.open_now", {}, "Aperto ora"),
      detail: formatOpeningDelta("closes", current.end, nowMinute),
    };
  }

  const next = intervals.find((interval) => interval.start > nowMinute);
  if (!next) {
    return {
      isOpen: false,
      label: t("map.closed_now", {}, "Chiuso ora"),
      detail: t("map.no_opening_records", {}, "Nessuna apertura registrata."),
    };
  }

  return {
    isOpen: false,
    label: t("map.closed_now", {}, "Chiuso ora"),
    detail: formatOpeningDelta("opens", next.start, nowMinute),
  };
}

export function formatOpeningDelta(kind, targetMinute, nowMinute) {
  const delta = targetMinute - nowMinute;
  if (delta < 6 * 60) {
    const duration = formatDuration(delta);
    return kind === "closes"
      ? t("map.closes_in", { duration }, `Chiude tra ${duration}`)
      : t("map.opens_in", { duration }, `Apre tra ${duration}`);
  }

  const target = weekMomentLabel(targetMinute);
  return kind === "closes"
    ? t("map.closes_at", { day: target.day, time: target.time }, `Chiude ${target.day} alle ${target.time}`)
    : t("map.opens_at", { day: target.day, time: target.time }, `Apre ${target.day} alle ${target.time}`);
}

export function mergedOpeningIntervals(schedule) {
  const week = 7 * 24 * 60;
  const intervals = [];
  schedule.forEach((ranges, weekday) => {
    ranges.forEach((range) => {
      const startBase = (weekday - 1) * 24 * 60 + range.opensMinutes;
      const endBase = range.is24h
        ? (weekday - 1) * 24 * 60 + 24 * 60
        : startBase + rangeDurationMinutes(range);
      for (let offset = -1; offset <= 2; offset += 1) {
        intervals.push({
          start: startBase + offset * week,
          end: endBase + offset * week,
        });
      }
    });
  });

  intervals.sort((a, b) => a.start - b.start);
  return intervals.reduce((merged, interval) => {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
      return merged;
    }
    merged.push({ ...interval });
    return merged;
  }, []);
}

export function rangeDurationMinutes(range) {
  if (range.is24h) return 24 * 60;
  if (range.closesMinutes <= range.opensMinutes) {
    return 24 * 60 - range.opensMinutes + range.closesMinutes;
  }
  return range.closesMinutes - range.opensMinutes;
}

export function formatHourRange(range) {
  const label = range.is24h
    ? escapeHtml(t("map.open_24h", {}, "24h"))
    : `${escapeHtml(formatClock(range.opensMinutes))}-${escapeHtml(formatClock(range.closesMinutes))}`;
  const note = range.note ? ` <span class="hours-note">${escapeHtml(range.note)}</span>` : "";
  return `<span>${label}${note}</span>`;
}

export function parseClockMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

export function formatClock(minutes) {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = String(Math.floor(normalized / 60)).padStart(2, "0");
  const mins = String(normalized % 60).padStart(2, "0");
  return `${hours}:${mins}`;
}

export function weekMomentLabel(weekMinutes) {
  const week = 7 * 24 * 60;
  const normalized = ((weekMinutes % week) + week) % week;
  const weekday = Math.floor(normalized / (24 * 60)) + 1;
  const minutes = normalized % (24 * 60);
  return {
    day: weekdayFullLabel(weekday),
    time: formatClock(minutes),
  };
}

export function weekMinute(date) {
  const weekday = isoWeekday(date);
  return (weekday - 1) * 24 * 60 + date.getHours() * 60 + date.getMinutes();
}

export function isoWeekday(date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

export function formatDuration(minutes) {
  const total = Math.max(1, Math.ceil(minutes));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days > 0) {
    return [days ? `${days} d` : "", hours ? `${hours} h` : ""].filter(Boolean).join(" ");
  }
  if (hours > 0) {
    return [hours ? `${hours} h` : "", mins ? `${mins} min` : ""].filter(Boolean).join(" ");
  }
  return `${mins} min`;
}

export function weekdayFullLabel(weekday) {
  const labels = {
    it: ["", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"],
    en: ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    fr: ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"],
    ar: ["", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"],
  };
  return (labels[state.lang] || labels.it)[Number(weekday)] || String(weekday);
}

export function renderSourceHours(display) {
  if (!display) return '<p>Orari non indicati.</p>';
  if ("raw_text" in display && display.scoped?.length) return `<p class="source-note">${escapeHtml(display.note)}</p>${display.scoped.map(b=>`<div class="access-section">${b.title?`<h4>${escapeHtml(b.title)}</h4>`:""}${b.labels.length?`<div class="service-chips">${b.labels.map(l=>`<span class="service-chip">${escapeHtml(l.kind)}: ${escapeHtml(l.text)}${l.interpreted?" (interpretazione in revisione)":""}</span>`).join("")}</div>`:""}<p class="source-hours-text">${escapeHtml(b.text)}</p></div>`).join("")}`;
  if ("raw_text" in display) return `<p class="source-note">${escapeHtml(display.note)}</p>${display.raw_text?`<p class="source-hours-text">${escapeHtml(display.raw_text)}</p>`:""}`;
  // Days without hours are closed when the source declares other days (user, 2026-11-15).
  const empty=display.days.some(d=>d.intervals.length) ? '<span class="unknown-value">Chiuso</span>' : '<span class="unknown-value">Non indicato</span>';
  return `${display.note ? `<p class="source-note">${escapeHtml(display.note)}</p>` : ""}<div class="source-week">${display.days.map(day=>`<div class="source-day"><strong>${escapeHtml(day.label)}</strong><span>${day.intervals.length ? day.intervals.map(v=>`<span>${escapeHtml(v.label)}${v.review_note ? ` <small>${escapeHtml(v.review_note)}</small>`:""}</span>`).join("<br>") : empty}${day.issues.length && !day.intervals.length ? `<small>${escapeHtml(day.issues.join("; "))}</small>`:""}</span></div>`).join("")}</div>${(display.warnings || []).map(w=>`<p class="source-note">${escapeHtml(w)}</p>`).join("")}`;
}

export function courseLevelLabel(code) {
  return ((state.taxonomy.course_levels || []).find(l => l.code === code) || {}).label || code;
}

/** Next lesson from now in Rome time, e.g. "Prossima lezione: oggi 18:00 (A1)" (within 7 days). */

export function nextLesson(display, now = new Date()) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:context.profile?.timezone || "UTC",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now).map(p=>[p.type,p.value]));
  const dayIndex=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(parts.weekday);
  const keys=["lun","mar","mer","gio","ven","sab","dom"];
  const minute=Number(parts.hour)*60+Number(parts.minute);
  for (let offset=0;offset<=7;offset++) {
    const day=(display.days || []).find(d=>d.day===keys[(dayIndex+offset)%7]);
    const next=(day?.intervals || []).filter(i=>{const a=parseClockMinutes(i.opens_raw);return a!==null && (offset>0 || a>minute);})
      .sort((a,b)=>a.opens_raw.localeCompare(b.opens_raw))[0];
    if (next) return `${offset===0 ? "oggi" : offset===1 ? "domani" : day.label.toLowerCase()} ${next.opens_raw}${next.level ? ` (${next.level})` : ""}`;
  }
  return null;
}

/** Courses are not desks: their status is the next lesson or the secretariat, never "Aperto ora". */

export function courseStatus(display, now = new Date()) {
  const note=display.opening_note || "";
  if (display.kind==="lessons") {
    const next=nextLesson(display, now);
    return {kind:"lessons",label:next ? `Prossima lezione: ${next}` : "Orari delle lezioni da verificare",note};
  }
  return {kind:display.kind==="office" ? "office" : "unknown",label:display.status_label || "Orario non disponibile",note};
}

export function sourceOpeningStatus(display, now = new Date()) {
  if (display?.canonical_opening) return canonicalOpeningStatus(display, now);
  if (["lessons","office","none"].includes(display?.kind)) return courseStatus(display, now);
  // Calculated from source intervals in Rome time, without asserting completeness.
  const unknown={kind:"unknown",label:"Orario non disponibile",note:display?.opening_note || "Orari della fonte non revisionati"};
  if (!display?.days || !Number.isFinite(now.getTime())) return unknown;
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:context.profile?.timezone || "UTC",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now).map(p=>[p.type,p.value]));
  const dayIndex=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(parts.weekday);
  const keys=["lun","mar","mer","gio","ven","sab","dom"];
  const day=display.days.find(d=>d.day===keys[dayIndex]);
  const minute=Number(parts.hour)*60+Number(parts.minute);
  const intervals=day?.intervals || [];
  if (day?.issues?.length || intervals.some(i=>i.review_note)) return {...unknown,label:"Orari da verificare"};
  // An interval ending before it starts crosses midnight (night shelters); 23:59 closes the day.
  const span=i=>{const a=parseClockMinutes(i.opens_raw);let b=parseClockMinutes(i.closes_raw);if(a===null||b===null)return null;if(b===1439)b=1440;return b>a?{today:[a,b]}:b<a?{today:[a,1440],next:[0,b]}:null;};
  const spans=intervals.map(span);
  if (spans.some(x=>x===null)) return {...unknown,label:"Orari da verificare"};
  const yesterday=display.days.find(d=>d.day===keys[(dayIndex+6)%7]);
  const carried=yesterday?.issues?.length ? [] : (yesterday?.intervals || []).map(span).filter(x=>x?.next).map(x=>x.next);
  const ranges=[...spans.map(x=>x.today),...carried].sort((a,b)=>a[0]-b[0]);
  // Merge overlapping or adjacent intervals before finding the closing boundary.
  const merged=[];
  ranges.forEach(([a,b])=>{const last=merged[merged.length-1];if(last && a<=last[1]) last[1]=Math.max(last[1],b);else merged.push([a,b]);});
  const active=merged.find(([a,b])=>a<=minute && minute<b);
  if (active && active[1]===1440) return {kind:"open",label:"Aperto ora",note:unknown.note};  // continues past midnight
  if (active) {
    const remaining=active[1]-minute;
    return {kind:remaining<=60 ? "closing" : "open",label:remaining<=60?`Aperto ora · chiude alle ${String(Math.floor(active[1]/60)).padStart(2,"0")}:${String(active[1]%60).padStart(2,"0")}`:"Aperto ora",note:unknown.note};
  }
  const upcoming=merged.find(([a])=>a>minute);
  if (upcoming) return {kind:"closed",label:`Chiuso ora · apre oggi alle ${String(Math.floor(upcoming[0]/60)).padStart(2,"0")}:${String(upcoming[0]%60).padStart(2,"0")}`,note:unknown.note};
  // A day without declared hours counts as closed when the source declares other days
  // (user decision, 2026-11-15); with no structured hours at all the status stays unknown.
  for (let offset=1;offset<=7;offset++) {
    const candidate=display.days.find(d=>d.day===keys[(dayIndex+offset)%7]);
    if (candidate?.issues?.length) continue;
    const next=(candidate?.intervals || []).filter(i=>!i.review_note && span(i)!==null).sort((a,b)=>a.opens_raw.localeCompare(b.opens_raw))[0];
    if (next) return {kind:"closed",label:`Chiuso ora · apre ${offset===1 ? "domani" : candidate.label.toLowerCase()} alle ${next.opens_raw}`,note:`${unknown.note} · giorni senza orari considerati chiusi`};
  }
  return unknown;
}

export function openingBadge(poi, now = new Date()) {
  const status=sourceOpeningStatus(poi.raw?.hours_display,now);
  return `<span class="source-opening ${status.kind}" data-opening-service="${escapeHtml(poi.id)}"><strong>${escapeHtml(status.label)}</strong><small>${escapeHtml(status.note)}</small></span>`;
}

export function updateOpeningBadges() {
  if (context.canonical) void refreshCanonicalOpening();
  // Filter membership must change at opening/closing boundaries as well as labels.
  if (state.filters.openNow) refresh();
  document.querySelectorAll("[data-opening-service]").forEach(el=>{
    const poi=state.pois.find(p=>String(p.id)===el.dataset.openingService);
    if (!poi) return;
    const status=sourceOpeningStatus(poi.raw?.hours_display);
    el.className=`${el.classList.contains("service-status") ? "service-status" : "source-opening"} ${status.kind}`;
    el.querySelector("strong").textContent=status.label;
    el.querySelector("small").textContent=status.note;
  });
}

/** Render canonical state from the calendar-aware SQL result, without source heuristics. */

/** Only an applicable latest human check can remove the verification reminder. */
export function hoursVerification(display){
  const checks=(display?.verification?.checks || []).filter(row=>row.scope==="page" || row.scope==="field" && row.field==="hours")
    .sort((a,b)=>String(a.checked_at).localeCompare(String(b.checked_at)));
  const check=checks.at(-1);
  return check?.outcome==="confirmed" && check.warning!=="review_due" ? check : null;
}

export function canonicalOpeningStatus(display, now = new Date()) {
  const opening=display.canonical_opening || {};
  const check=hoursVerification(display);
  const hint=check ? "" : " · da verificare";
  const note=check ? `Verifica registrata il ${String(check.checked_at).slice(0,10)}. Non è disponibilità in tempo reale.` : "Orari interpretati come verosimilmente completi, in attesa di verifica. Contatta il servizio per conferma.";
  const transition=opening.next_transition_at ? new Date(opening.next_transition_at) : null;
  if (transition && transition.getTime()<=now.getTime()) return {kind:"unknown",label:"Aggiornamento degli orari in corso",note};
  if (opening.status==="open") {
    const closes=opening.closes_at ? new Date(opening.closes_at) : null;
    const closing=closes && closes.getTime()>now.getTime() && closes.getTime()-now.getTime()<=3600000;
    return {kind:closing?"closing":"open",label:closing ? `Aperto${hint} · chiude alle ${new Intl.DateTimeFormat("it-IT",{timeZone:opening.timezone || context.profile?.timezone || "UTC",hour:"2-digit",minute:"2-digit"}).format(closes)}` : `Aperto${hint}`,note};
  }
  if (opening.status==="closed") return {kind:"closed",label:`Chiuso${hint}`,note};
  return {kind:"unknown",label:"Orario da verificare",note};
}

/** Show selected canonical conditions and preserve each supplementary field's source. */

export function renderCanonicalHours(poi) {
  const days=poi.raw.hours_display?.days || [];
  const rows=days.map(day=>{
    const intervals=(day.intervals || []).map(interval=>escapeHtml(interval.label)).join("<br>");
    const label=intervals || (day.state==="closed" ? `Chiuso${hoursVerification(poi.raw?.hours_display) ? "" : " · da verificare"}` : "Da verificare");
    return `<tr><th scope="row">${escapeHtml(day.label)}</th><td>${label}</td></tr>`;
  }).join("");
  return `<section class="detail-section service-section" id="sec-orari"><h3>Orari dichiarati</h3><table class="hours-table"><tbody>${rows}</tbody></table><p class="service-advice">Calendario interpretato come completo, in attesa di verifica. Giorni e fasce incerti restano da verificare. Le fasce notturne proseguono nel giorno seguente; eccezioni e variazioni possono prevalere.</p></section>`;
}
