/** Common sky shaders copied from Kaisen 3d751051, without its ocean dependency. */
export const skyVertex = `
varying vec3 vPosition;
void main(){
 vPosition=position;
 gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
}`;

export const skyFragment = `
varying vec3 vPosition;
void main(){
 vec3 p=normalize(vPosition);
 float h=max(0.,p.y);
 vec3 sun=normalize(vec3(-.6,.65,-.35));
 float sunFacing=max(0.,dot(p,sun));
 vec3 c=mix(vec3(.66,.78,.80),vec3(.16,.35,.52),pow(h,.48));
 float horizon=exp(-h*20.);
 c=mix(c,vec3(.73,.80,.79),horizon*.26);
 c+=vec3(.29,.21,.105)*pow(sunFacing,28.);
 c+=vec3(.53,.41,.21)*pow(sunFacing,520.);
 // Wide cloud banks use a few bounded harmonics, without textures or screen fog.
 float cloud=sin(p.x*20.+p.z*8.)*.48+sin(p.z*31.-p.x*10.)*.32+sin(p.x*49.+p.z*39.)*.20;
 float band=smoothstep(.08,.20,h)*(1.-smoothstep(.39,.56,h));
 float coverage=smoothstep(.25,.72,cloud)*band;
 c=mix(c,vec3(.80,.84,.83),coverage*.43);
 gl_FragColor=vec4(c,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;
