export function showClickInfo(x: number, y: number){
  const marker = document.createElement('div');
  marker.style.width = '2px';
  marker.style.height = '2px';
  marker.style.backgroundColor = 'blue';
  marker.style.position = 'absolute';
  marker.style.left = `${x}px`;
  marker.style.top = `${y}px`;
  marker.style.border = '5px solid red';
  marker.style.borderRadius = '50%';
  marker.style.zIndex = '2000000001';
  (marker as any).dataset.x = String(x);
  (marker as any).dataset.y = String(y);
  document.body.appendChild(marker);
}
