// In-game map contour lines: an SCR_MapConfig override (text) to plug into the GameMode's SCR_MapConfigComponent.
// Template ported from giorbev's fond_topo.py MAP_CONFIG / MAP_CONFIG_MURS (MIT, Copyright (c) giorbev).
// Zoom levels 1..4 = the four SCR_LayerConfiguration GUIDs of MapLayersDefault.conf, in order.
export interface ContourSettings {
  density: [number, number, number, number]       // minor interval (m) per zoom level
  major: [number, number, number, number]         // major interval (m) per zoom level
  width: number; majorWidth: number
  land: [number, number, number, number]          // RGBA 0..1
  coastalAlpha: number                            // 0 hides the coastline drawn by the game
  hideWalls: boolean
}
export const CONTOUR_DEFAULTS: ContourSettings = {
  density: [5, 10, 20, 50], major: [25, 50, 100, 250], width: 1.3, majorWidth: 2.6,
  land: [0.28, 0.12, 0.05, 0.95], coastalAlpha: 0, hideWalls: false,
}
export const CONTOUR_FILE = 'MGP_MapFullscreen_courbes.conf'
const LAYER_GUIDS = ['54D50001FDCE8F33', '54D50001FDAC5B34', '54D50001C2EE1562', '54D50001C3C8B072']
const f = (v: number) => String(Math.round(v * 1000) / 1000)

export function contourConf(s: ContourSettings): string {
  const layers = LAYER_GUIDS.map((g, i) => `     SCR_LayerConfiguration "{${g}}" {\n      m_fContourDensity ${f(s.density[i])}\n      m_fMajorContourDensity ${f(s.major[i])}\n     }`).join('\n')
  const walls = s.hideWalls ? `     SCR_BuildingPropsConfig "{5592D3961E4DC088}" {\n      m_aBuildingTypes {\n       SCR_BuildingTypeProps "{5A16C2F7EB6E9ECF}" {\n        m_FillColor 0.204 0.204 0.204 0\n       }\n      }\n     }\n` : ''
  return `SCR_MapConfig : "{1B8AC767E06A0ACD}Configs/Map/MapFullscreen.conf" {
 m_LayersConfig SCR_MapLayersBase "{58C8DDC97E580BED}" : "{3CAC09C3E89190F7}Configs/Map/MapLayersDefault.conf" {
  m_aLayers {
${layers}
  }
 }
 m_MapPropsConfig SCR_MapPropsBase "{58C89E75E1BB275D}" : "{AF65563F653FED68}Configs/Map/MapPropsDefault.conf" {
  m_aMapPropConfigs {
${walls}     SCR_ContourPropsConfig "{55948AFEC4F12B7D}" {
      m_fContourWidth ${f(s.width)}
      m_fMajorContourWidth ${f(s.majorWidth)}
      m_LandColor ${s.land.map(f).join(' ')}
      m_CoastalColor 0.202 0.064 0.031 ${f(s.coastalAlpha)}
     }
  }
 }
}
`
}

/** image size accepted by the Workbench for the map background: multiple of 4 */
export const mapSize = (n: number) => Math.max(4, Math.floor(n / 4) * 4)
