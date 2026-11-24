// Publicar lo que commiteó claude (push a GitHub) y seguir el deploy hasta que la web nueva está en línea.
import { checksDeploy, estadoDeploy, leerChecks, modoPublicacion, motivosPublicar } from '../servidor-logica.mjs';
import { CONFIG_ARCHIVO, SIN_NADA_MS, TOPE_DEPLOY_MS } from './constantes.mjs';
import { emit } from './conversaciones.mjs';
import { cancelables, convs, estado } from './estado.mjs';
import { git, readConfig, run, writeJsonFile } from './utilidades.mjs';

// ---------- seguimiento del deploy (lógica de la v1, por lo que la plataforma le informa a GitHub) ----------
export async function followDeploy(o) {
  const { cwd, sha, filtro, destino, queCambio, emit } = o;
  const intervalo = o.intervaloMs ?? 10000;
  const limite = Date.now() + (o.limiteMs ?? TOPE_DEPLOY_MS);
  const sinNadaHasta = Date.now() + (o.sinNadaMs ?? SIN_NADA_MS);
  const remoto = (await git(cwd, 'remote', 'get-url', 'origin')).out;
  const ownerRepo = remoto.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '');
  let avisoArmando = false;
  let fallasGh = 0;
  const dormir = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (o.cancelar) o.cancelar.push(() => { clearTimeout(t); r(); }); });
  while (Date.now() < limite) {
    await dormir(intervalo);
    if (o.cerrado && o.cerrado()) return;
    const st = await run('gh', ['api', `repos/${ownerRepo}/commits/${sha}/status`]);
    const cr = await run('gh', ['api', `repos/${ownerRepo}/commits/${sha}/check-runs`]);
    const leido = leerChecks(st, cr);
    // gh caído (sesión vencida, sin red): eso no es «no hay deploy». Un minuto seguido así y se dice tal cual.
    if (!leido.valida) {
      if (++fallasGh >= 6) {
        const porQue = (st.ok ? cr.err : st.err).split('\n').filter(Boolean).pop() || 'sin respuesta';
        emit({ tipo: 'publicacion', paso: 'tope', texto: `Subido a GitHub (${destino}), pero no pude preguntarle a GitHub por el deploy (gh: ${porQue.slice(0, 160)}). Mirá la plataforma.` });
        return;
      }
      continue;
    }
    fallasGh = 0;
    const { items, aprender } = checksDeploy(leido.items, filtro);
    emit({ tipo: 'depuracion', items });
    if (!items.length) {
      if (Date.now() > sinNadaHasta) {
        emit({ tipo: 'publicacion', paso: 'sin-deploy', texto: `Publicado en GitHub (${destino}). No vi ningún deploy que seguir para este proyecto.` });
        return;
      }
      continue;
    }
    const e = estadoDeploy(items);
    if (e.estado === 'fallo') {
      emit({ tipo: 'publicacion', paso: 'fallo', texto: `El deploy falló (${e.item.nombre}). La web sigue con la versión anterior.` });
      return;
    }
    if (e.estado === 'cancelado') {
      emit({ tipo: 'publicacion', paso: 'tope', texto: `Subido, pero el deploy se canceló (${e.item.nombre}): suele ser porque lo reemplazó uno más nuevo. Mirá la plataforma.` });
      return;
    }
    if (e.estado === 'publicado') {
      if (aprender && o.aprender) o.aprender(aprender);
      const hora = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
      emit({ tipo: 'publicacion', paso: 'publicado', texto: `Publicado ${hora}: ${queCambio}` });
      return;
    }
    if (!avisoArmando) { emit({ tipo: 'publicacion', paso: 'armando', texto: 'Armando la web nueva…' }); avisoArmando = true; }
  }
  emit({ tipo: 'publicacion', paso: 'tope', texto: `Subido, pero el deploy no terminó en ${Math.round((o.limiteMs ?? TOPE_DEPLOY_MS) / 60000)} minutos. Mirá la plataforma.` });
}

export async function publicarPendiente(c) {
  const p = c.pendiente;
  c.pendiente = null;
  const despues = (await git(p.t.cwd, 'rev-parse', 'HEAD')).out;
  await publicar(c, p.t, despues);
}

export async function publicar(c, t, despues) {
  const { proy, antes, rama } = t;
  const cwd = proy.carpeta;
  const destino = proy.publicarEn || rama;
  const sinRemoto = !(await git(cwd, 'remote', 'get-url', 'origin')).ok;
  const modo = modoPublicacion(proy, sinRemoto);
  if (modo === 'no') {
    emit(c, { tipo: 'publicacion', paso: 'local', texto: sinRemoto ? 'Commit hecho. El repo no tiene GitHub: queda en tu compu.' : 'Commit hecho. Este proyecto no se publica: queda en tu compu.' });
    return;
  }
  await git(cwd, 'fetch', 'origin', destino, '--quiet');
  const ajenos = (await git(cwd, 'log', '--format=%h %s', `origin/${destino}..${antes}`)).out.split('\n').filter(Boolean);
  const motivos = motivosPublicar({ proy, rama, ajenos });
  if (motivos.length) {
    emit(c, { tipo: 'publicar-confirmar', motivos });
    const ok = await new Promise((resolve) => { c.confirmacion = { resolve }; });
    c.confirmacion = null;
    // Contestada también en el historial: al recargar la ventana (Alt+F2, el celular) la tarjeta vuelve sin botones y
    // no traba la pestaña esperando una respuesta que ya se dio.
    const pregunta = c.historial.findLast((e) => e.tipo === 'publicar-confirmar');
    if (pregunta) pregunta.respondida = ok ? 'si' : 'no';
    if (estado.cerrando || !convs.has(c.id)) return;
    if (!ok) { emit(c, { tipo: 'publicacion', paso: 'cancelado', texto: 'Quedó commiteado sin publicar.' }); return; }
  }
  const asunto = (await git(cwd, 'log', '-1', '--format=%s', despues)).out;
  // pasos: cuántos muestra la tarjeta (sin deploy no hay «Armando» ni «Publicado»).
  emit(c, { tipo: 'publicacion', paso: 'push', pasos: modo === 'github' ? 2 : 4, texto: `Publicando ${despues.slice(0, 7)}…` });
  // El commit que se publicó, no HEAD: si otra pestaña del mismo repo commiteó en el medio, eso no sale sin confirmar.
  // Tope largo: el hook pre-push de los repos con app (Marito, clima-sur) arma la app y la sube a Play antes de salir.
  const push = await run('git', ['push', 'origin', `${despues}:refs/heads/${destino}`, '--quiet'], { cwd, timeout: 10 * 60 * 1000 });
  if (!push.ok) { emit(c, { tipo: 'publicacion', paso: 'fallo', texto: `Falló el push, no se publicó. ${push.err.split('\n').slice(-2).join(' ')}` }); return; }
  for (const tag of (await git(cwd, 'tag', '--points-at', despues)).out.split('\n').filter(Boolean)) await git(cwd, 'push', 'origin', `refs/tags/${tag}`, '--quiet');
  if (modo === 'github') {
    emit(c, { tipo: 'publicacion', paso: 'sin-deploy', texto: `Subido a GitHub (${destino}): ${asunto}. No tiene deploy; se usa desde tu compu.` });
    return;
  }
  await followDeploy({
    cwd, sha: despues, filtro: String(proy.deploy || ''), destino, queCambio: asunto,
    emit: (ev) => { if (ev.tipo !== 'depuracion') emit(c, ev); },
    cancelar: cancelables, cerrado: () => estado.cerrando || !convs.has(c.id),
    aprender: (nombre) => { try { const cf = readConfig(); const p = (cf.proyectos || []).find((x) => x.nombre === proy.nombre); if (p && !p.deploy) { p.deploy = nombre; proy.deploy = nombre; writeJsonFile(CONFIG_ARCHIVO, cf); } } catch { /* idem */ } },
  });
}
