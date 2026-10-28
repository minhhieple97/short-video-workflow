// Every notebook and source this app creates carries the ID of its binding in its title. After a create whose answer was
// lost, that marker is how the app recognises its own object among the notebook's contents, without guessing by name.
export function bindingMarker(bindingId: string): string {
  return `[bvs:${bindingId}]`;
}

export function titleWithMarker(title: string, bindingId: string): string {
  return `${title.trim().slice(0, 150)} ${bindingMarker(bindingId)}`;
}

export function hasBindingMarker(title: string, bindingId: string): boolean {
  return title.includes(bindingMarker(bindingId));
}
