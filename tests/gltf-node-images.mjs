// Geometry/rig tests do not render pixels. Decode textures in browser validation;
// allow GLTFLoader's ImageBitmap path to complete in Node's DOM-free runtime.
globalThis.self=globalThis;
globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
globalThis.ProgressEvent ??= class ProgressEvent {constructor(type,init={}){this.type=type;Object.assign(this,init);}};
