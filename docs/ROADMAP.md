# Roadmap

Stack : Vite + TypeScript, MapLibre GL, d3-delaunay, poisson-disk-sampling, simplex-noise, turf, proj4. 100 % navigateur.

1. **Forêts → Forest Generator** : dessiner/importer des polygones forêt → export `.layer` de shapes avec générateur natif.
2. **Auto-remplissage prefabs** : règles par biome, Poisson-disk, haies/rochers → `.layer` d'entités. Catalogue de prefabs vanilla (GUID).
3. **Campagne** (port AgriFieldGenerator) : parcelles Voronoi, haies sur bordures, chemins.
4. **Monde réel** (specs BARNMAP) : zone → DEM `.asc`, WorldCover + OSM → masques et shapes.
5. **Peinture des sols** (port Map-generator + mapgen4) : masques depuis relief, aperçu live.
6. **Budget plateforme** : compteur d'entités/densité, alertes Series S/X, PS5, PC.
