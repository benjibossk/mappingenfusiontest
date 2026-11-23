// Base entities a playable world needs: the list of Workbench's own "Plugins > World Setup > Entities Setup"
// (Configs/Workbench/WorldEditor/WorldSetupPlugin/1_BaseWorldSetup.conf, base game 1.6+; pointed out by Lou Montana).
// We only read the world's layer files and report what is missing; adding them stays the Workbench plugin's job.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const BASE_ENTITIES = [
  ["221ABC927C672E4E", "GenericTerrain"], ["33F9FD881E3700CC", "CameraManager"], ["5B2B348D9520F7C7", "Lighting"],
  ["78D9BBF0F423FEB4", "FogHaze"], ["3AFFB0B0EC055284", "GenericWorldPP"], ["A3BAF78F6F03315B", "TimeAndWeatherManager"],
  ["B6B6A21399C5571B", "EnvProbe"], ["E5B570B5F32A7BAE", "DestructionManager"], ["9BB369F2803C6F71", "MPDestructionManager"],
  ["104F8505FD1871EF", "PreloadManager"], ["434AFBBE90F2B078", "AmbientSounds"], ["66B93BC296E2F977", "RadioBroadcastManager"],
  ["7699E66077068406", "ForestSyncManager"], ["FBE5065D0273E9E1", "SoundWorld"], ["359452CCDBDD03F6", "MusicManager"],
  ["731564B66F91B107", "MapEntity"],
];

/** names of the base entities missing from a world (its .ent + every .layer); a variant prefab with the same
 *  name stem (Lighting_Everon for Lighting_Default) counts as present */
export function missingBaseEntities(worldEnt) {
  const files = [worldEnt];
  const layers = worldEnt.replace(/\.ent$/i, "_Layers");
  if (existsSync(layers)) for (const f of readdirSync(layers)) if (f.endsWith(".layer")) files.push(join(layers, f));
  const text = files.filter(existsSync).map((f) => readFileSync(f, "latin1")).join("\n");
  return BASE_ENTITIES.filter(([guid, name]) => !text.includes(guid) && !new RegExp(`/${name}[_.A-Za-z0-9]*\.et`).test(text)).map(([, n]) => n);
}
