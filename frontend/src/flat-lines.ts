import {
  BoundingSphere,
  ComponentDatatype,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  PrimitiveType,
} from "cesium";

/** Cesium's longitude splitter copies position/applyOffset for LINES, not normals. */
export function flatLineGeometry(values: Float64Array) {
  return new Geometry({
    attributes: Object.assign(new GeometryAttributes(), {
      position: new GeometryAttribute({
        componentDatatype: ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values,
      }),
    }),
    primitiveType: PrimitiveType.LINES,
    boundingSphere: BoundingSphere.fromVertices(values),
  });
}

// Uniform material color keeps fade updates independent of the number of stems.
// Flat shading needs no per-vertex normal; supply a constant for the material API.
export const flatLineVertexShader = `
in vec3 position3DHigh;
in vec3 position3DLow;
in float batchId;
out vec3 v_positionEC;
out vec3 v_normalEC;
void main() {
  vec4 p = czm_computePosition();
  v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
  v_normalEC = vec3(0.0, 0.0, 1.0);
  gl_Position = czm_modelViewProjectionRelativeToEye * p;
}`;
