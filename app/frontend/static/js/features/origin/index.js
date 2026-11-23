import {escapeHtml} from "../../format.js";
/** createOrigin owns its behavior; dependencies and snapshots are explicit. */
export function createOrigin({context,scope,http,contains,translate,emit}) {
let state={};const runtime={addressRequest:null};const locStatus=document.getElementById("loc-status");const t=translate;const isWithinCityBounds=contains;const managedFetch=http.request;const toast=message=>emit("toast",{message});
function locateUser() {
  if (!navigator.geolocation) {
    locStatus.className = "loc-status err";
    locStatus.innerHTML = `<span class="label">${escapeHtml(t("map.position"))}</span>${escapeHtml(t("map.no_position_set"))}`;
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      if(scope.signal.aborted)return;
      setUserLocation(position.coords.latitude, position.coords.longitude, t("map.detected_position"));
    },
    () => {
      if(scope.signal.aborted)return;
      locStatus.className = "loc-status err";
      locStatus.innerHTML = `<span class="label">${escapeHtml(t("map.position"))}</span>${escapeHtml(t("map.no_position_set"))}`;
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function setUserLocation(lat,lng,label) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180) return toast("Coordinate non valide");
  if (!isWithinCityBounds(lat,lng)) return toast(`Scegli un punto nell’area di ${context.cityName}`);
  emit("reference",{lat,lng,label});
  document.getElementById("sort-services").value="distance";
  const named = !/^(Punto|Posizione rilevata|Detected)/i.test(label);
  const display = named ? label : `${label} · ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  document.getElementById("reference-status").textContent=`Distanze in linea d’aria da ${display}`;
  locStatus.className="loc-status ok";
  locStatus.textContent=display;
  emit("center",{lat,lng});
  emit("closeSheets");
}

async function geocodeAddress(address) {
  if (address.length<3) return;
  runtime.addressRequest?.abort();
  const current=new AbortController(); runtime.addressRequest=current;
  const status=document.getElementById("address-search-status");
  const results=document.getElementById("address-results");
  results.replaceChildren(); status.textContent="Cerco indirizzo…";
  try {
    const response=await managedFetch("/api/preview/address-search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:address}),signal:current.signal});
    if (!response.ok) throw Error("unavailable");
    const data=await response.json();
    if (scope.signal.aborted || current.signal.aborted) return;
    status.textContent=data.results.length ? "Scegli un risultato:" : `Nessun risultato nell’area di ${context.cityName}. Prova un indirizzo più preciso o scegli sulla mappa.`;
    for (const row of data.results) {
      const button=document.createElement("button"); button.type="button"; button.className="address-result"; button.textContent=row.label;
      button.addEventListener("click",()=>{setUserLocation(row.lat,row.lon,row.label); results.replaceChildren(); status.textContent="Indirizzo selezionato.";}, {signal: scope.signal});
      results.appendChild(button);
    }
  } catch(error) {
    if (scope.signal.aborted || current.signal.aborted) return;
    status.textContent="Ricerca indirizzo non disponibile. Puoi usare la geolocalizzazione o scegliere sulla mappa.";
  }
}

function chooseReferencePoint() {
  emit("chooseReference");
  document.getElementById("reference-status").textContent = "Tocca un punto sulla mappa come riferimento";
  toast("Tocca la mappa per scegliere il riferimento");
}

function update(snapshot){state=snapshot;}
function dispose(){runtime.addressRequest?.abort();}

return {update,locate:locateUser,search:geocodeAddress,choose:chooseReferencePoint,set:setUserLocation,dispose};
}
