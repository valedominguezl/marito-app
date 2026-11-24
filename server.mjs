// Marito v3: servidor local. Corre `claude -p` (varias conversaciones a la vez), sirve la interfaz, publica y sigue el deploy.
// Uso:  node server.mjs <carpeta-sesion> [pid-del-padre] [--fijo]
//       --fijo: queda prendido aunque se cierre la ventana (lo arranca servidor-fijo.ps1) y, si remoto.json lo dice,
//       atiende también al celular por Tailscale (solo a la IP del teléfono).
//       node server.mjs --probar-deploy <carpeta-repo> <sha> [filtro-deploy]   (solo lectura de GitHub, para probar)
// Sin dependencias npm. Escucha solo en 127.0.0.1 y exige el token que le pasa abrir.ps1 (contexto.json).
// El código está partido por tema en servidor/ (ver el encabezado de cada módulo); este archivo solo elige qué modo corre.

import { main } from './servidor/arranque.mjs';
import { followDeploy } from './servidor/publicacion.mjs';
import { esGenerico, findRepos, readConfig, vscodeFolders } from './servidor/utilidades.mjs';

// ---------- modo de prueba: solo lectura del estado de un commit en GitHub ----------
if (process.argv[2] === '--probar-deploy') {
  const [, , , repo, sha, filtro] = process.argv;
  const cuando = (e) => console.log(JSON.stringify(e));
  followDeploy({ cwd: repo, sha, filtro: filtro || '', destino: 'main', queCambio: 'prueba', emit: cuando,
    intervaloMs: 3000, limiteMs: 60000, sinNadaMs: 20000, aprender: () => {} }).then(() => process.exit(0));
} else if (process.argv[2] === '--probar-proyectos') {
  // Solo lectura: lista lo que vería la ventana (proyectos conocidos, repos y carpetas de VS Code).
  const out = []; const cfg = readConfig();
  if (cfg.raiz) findRepos(cfg.raiz, 0, out);
  console.log(JSON.stringify({ vscode: vscodeFolders(), repos: out.length, genericos: esGenerico('docs.google.com') }, null, 1));
} else {
  main();
}
