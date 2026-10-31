import {Cartesian3, type Camera} from "cesium";

/** Angular room for an entire globe inside the smaller viewport dimension.
 * Regional close-ups intentionally keep their existing tilt/zoom behavior. */
export function globeOverviewAngle(camera: Camera, radius: number) {
  const distance=Cartesian3.magnitude(camera.positionWC),m=camera.frustum.projectionMatrix;
  if(distance<=radius || m[15]!==0 || !m[0] || !m[5])return -1;
  const half=Math.min(Math.atan(1/Math.abs(m[0])),Math.atan(1/Math.abs(m[5])));
  return half-Math.asin(radius/distance)-.015;
}

/** Keep an overview's center from leaving the frame. Only correct a lost
 * center when the whole globe could fit; partially clipped oblique views and
 * normal regional pan/zoom anchors retain their existing behavior.
 * Rotate the view minimally toward Earth, retaining camera position and roll. */
export function keepGlobeInView(camera: Camera, radius: number) {
  if(globeOverviewAngle(camera,radius)<0)return false;
  const position=camera.positionWC,m=camera.frustum.projectionMatrix;
  const horizontal=Math.atan(1/Math.abs(m[0])),vertical=Math.atan(1/Math.abs(m[5]));
  const x=-Cartesian3.dot(position,camera.rightWC),y=-Cartesian3.dot(position,camera.upWC),z=-Cartesian3.dot(position,camera.directionWC);
  if(z*Math.sin(horizontal)-Math.abs(x)*Math.cos(horizontal)>=0 &&
     z*Math.sin(vertical)-Math.abs(y)*Math.cos(vertical)>=0)return false;
  const room=Math.min(horizontal,vertical)-.015;
  const center=Cartesian3.normalize(Cartesian3.negate(position,new Cartesian3()),new Cartesian3());
  const angle=Math.acos(Math.max(-1,Math.min(1,Cartesian3.dot(camera.directionWC,center))));
  const correction=angle-room;
  if(correction<1e-10)return false;
  const axis=Cartesian3.cross(camera.directionWC,center,new Cartesian3());
  if(Cartesian3.magnitudeSquared(axis)<1e-20)Cartesian3.clone(camera.upWC,axis);
  Cartesian3.normalize(axis,axis);
  camera.look(camera.worldToCameraCoordinatesVector(axis,new Cartesian3()),-correction);
  return true;
}
