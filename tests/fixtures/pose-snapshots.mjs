export function snapshot(id = 'neutral', visibility = 1) {
  const pts = { L_SH: {x:-.5,y:1}, R_SH:{x:.5,y:1}, L_HIP:{x:-.3,y:0}, R_HIP:{x:.3,y:0},
    L_WR:{x:-.6,y:-.1},R_WR:{x:.6,y:-.1}, L_EL:{x:-.6,y:.5},R_EL:{x:.6,y:.5}, NOSE:{x:0,y:1.6} };
  if (['both_up','left_up'].includes(id)) { pts.L_WR.y=2; pts.L_EL.y=1.5; }
  if (['both_up','right_up'].includes(id)) { pts.R_WR.y=2; pts.R_EL.y=1.5; }
  if (id==='lean_left') pts.R_SH.y+=.4;
  if (id==='lean_right') pts.L_SH.y+=.4;
  return {present:true,calibrated:true,shoulderW:1,pts,vis:Object.fromEntries(Object.keys(pts).map(k=>[k,visibility]))};
}
