/** Tell which map engine a layer factory receives through the map module's attach seam. */
export function isMapLibre(map) {
  return Boolean(map && typeof map.addSource === "function" && typeof map.getPane !== "function");
}

/** A layer handle that does nothing, for an engine a layer does not support yet. */
export function inertLayer() {
  return {setVisible() {}, isVisible: () => false, reload() {}, focus() {}, clearFocus() {}, focusedRoutes: () => null, dispose() {}};
}
