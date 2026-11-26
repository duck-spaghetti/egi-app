import {escapeHtml,categoryCaption} from "../../format.js";
/** Site pin markup shared by the map modules (Leaflet and 3D).
 *
 * siteMarkers(list,{sites,describe}) turns the filtered services into one marker
 * description per site: position, pin HTML, accessible label and the services to
 * open on selection. pinHtml draws the conic-gradient pin; USER_DOT_HTML the chosen
 * reference point. Map modules only wrap this markup in their own marker type.
 */

export function iconPath(iconPath) {
  const raw = String(iconPath || "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/^\/+/, "");
  if (!cleaned.endsWith(".svg")) return null;
  if (/^static\/assets\/icons\/[a-zA-Z0-9_ /-]+\.svg$/.test(cleaned)) return `/${cleaned}`;
  if (cleaned.startsWith("icons/")) return `/static/assets/${cleaned}`;
  if (cleaned.startsWith("assets/icons/")) return `/static/${cleaned}`;
  return null;
}

export function pinHtml(poi, describe) {
  const categories = poi.site_categories || [describe(poi).category || {label:poi.category_label,color:poi.category_color,icon_path:poi.category_icon_path}];
  const weights = poi.site_weights || categories.map(()=>1);
  const total = weights.reduce((a,b)=>a+b,0);
  let position=0;
  const colorStops=categories.map((c,i)=>{const start=position; position+=weights[i]/total*100; return `${c.color || "#555"} ${start}% ${position}%`;}).join(",");
  const c=categories[0];
  const icon=iconPath(c.icon_path);
  const content=poi.group_count>1 ? `<span class="site-total">${poi.group_count}</span>` : `<span class="single-pin-icon">${icon ? `<img src="${escapeHtml(icon)}" alt="">` : escapeHtml(String(c.label||c.slug||"•").trim().charAt(0).toUpperCase())}</span>`;
  return `<div class="site-pin ${poi.group_count>1 ? "multi" : "single"}" style="background:conic-gradient(${colorStops})">${content}</div>`;
}

export const PIN_SIZE=[44,44], PIN_ANCHOR=[22,44];
export const USER_DOT_HTML='<div class="user-dot"></div>', USER_DOT_SIZE=[18,18];
export const USER_DOT_LABEL="Punto di riferimento scelto";

/** One marker description per site among the filtered services. */
export function siteMarkers(list,{sites,describe}) {
  const matched = new Set(list.map(p => p.id)),descriptions=new Map();
  const presentation=poi=>{const key=poi.id??poi;if(!descriptions.has(key))descriptions.set(key,describe(poi));return descriptions.get(key);};
  return sites.groups(list).map(items => {
    const categories = [...new Map(items.map(p => {const c=presentation(p).category; return [c?.slug,c];})).values()].filter(Boolean);
    const poi = {...items[0], group_count:items.length, site_categories:categories, site_weights:categories.map(c=>items.filter(item=>presentation(item).category?.slug===c.slug).length)};
    const label = `${poi.raw?.facility_name || poi.title}: ${items.length} servizi · ${categories.map(c=>categoryCaption(c.label || c.slug)).join(", ")}`;
    const siblings=sites.siblings(poi);
    const allCategories=[...new Map(siblings.map(p=>{const c=presentation(p).category;return [c?.slug,c];})).values()].filter(Boolean)
      .map(c=>({...c,matched:categories.some(m=>m.slug===c.slug)}));
    return {lat:poi.latitude,lng:poi.longitude,html:pinHtml(poi,presentation),label,
      name:presentation(items[0]).title||poi.raw?.facility_name||poi.title,items,serviceIds:siblings.map(p=>String(p.id)),categories,allCategories,
      statuses:items.map(p=>presentation(p).status),choose:()=>({items:siblings,matched})};
  });
}
