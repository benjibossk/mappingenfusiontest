#ifdef WORKBENCH
//! Writes a whole height grid into the open terrain with SetTerrainSurfaceTile (Reforger 1.9+, no import dialog).
//!
//! Input file (same layout as MG_ExportHeights): header "minX minZ step cols rows", then one line per row,
//! row 0 = minZ (south), west to east, heights in metres. The grid is sampled bilinearly at every terrain
//! vertex, so its step does not have to match the terrain cell.
//!
//! Method (measured on MG_Test, docs/ARCHITECTURE.md): an EXACT stamp with an n x n array, n = 2 * fOuterSize + 1,
//! maps one value per vertex from -fOuterSize to +fOuterSize; value = weight w, h = ground + w * (H - ground);
//! array index = ix * n + iz (outer index along X). Pass 1 flattens to the grid minimum (w = 1),
//! pass 2 raises with H = maximum and w = (target - min) / (max - min).
//! PRECONDITION: the terrain has a normal map (else edits are silently ignored).
class MG_HeightmapApplier
{
	static const int HALF = 64; // fOuterSize in vertices -> stamps of 129 x 129
	static const bool Z_FLIP = false; // set true if the north/south test comes out mirrored

	protected float m_fMinX, m_fMinZ, m_fStep;
	protected int m_iCols, m_iRows;
	protected ref array<float> m_aH = {};
	// finer local patches (heightpatch.txt, written by the bridge: harbour quay step at 2 m), sampled before the grid
	protected ref array<float> m_aPHead = {}; // minX minZ step cols rows, 5 per patch
	protected ref array<float> m_aPH = {};
	protected ref array<int> m_aPOff = {};

	//------------------------------------------------------------------------------------------------
	//! Returns a report; starts with "error:" on failure.
	string Apply(string file)
	{
		string err = Load(file);
		if (err)
			return "error: " + err;
		int patches = LoadPatches("$profile:MapGen/heightpatch.txt");

		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		WorldEditorAPI api = worldEditor.GetApi();
		vector mins, maxs;
		if (!api || !worldEditor.GetTerrainBounds(mins, maxs))
			return "error: no world / terrain open in edit mode";

		int vx = api.GetTerrainResolutionX(0);
		int vz = api.GetTerrainResolutionY(0);
		if (vx < 2 || vz < 2)
			return "error: terrain resolution unknown";
		int tilesX = api.GetTerrainTilesX(0);
		int tilesZ = api.GetTerrainTilesY(0);
		if (tilesX < 1 || tilesZ < 1)
			return "error: terrain tiles unknown";
		int tw = vx / tilesX;
		int th = vz / tilesZ;
		float cell = api.GetTerrainUnitScale(0);
		if (cell <= 0)
			cell = (maxs[0] - mins[0]) / (vx - 1);

		// Reforger 1.9: the brush API (TerrainToolDesc / ModifyHeightMapUserShape) is gone from scripts;
		// heights are written per tile, world-space metres, row-major (x fastest), tw x th values.
		// a tile is usually (step + 1)^2 values: neighbours share their edge vertices (2049 = 16 * 128 + 1)
		int stepX = (vx - 1) / tilesX;
		int stepZ = (vz - 1) / tilesZ;
		int tiles;
		int firstCount = -1;
		bool firstGet;
		array<float> tile = {};
		array<float> wr = {};
		int tilesFull;
		bool began = api.BeginTerrainAction();
		for (int ty; ty < tilesZ; ty++)
		{
			Print(string.Format("[MapGen] progress: relief row %1/%2", ty + 1, tilesZ), LogLevel.NORMAL);
			for (int tx; tx < tilesX; tx++)
			{
				bool got = api.GetTerrainSurfaceTile(0, tx, ty, tile);
				if (firstCount < 0)
				{
					firstCount = tile.Count();
					firstGet = got;
				}
				if (!got)
					continue;
				int n = tile.Count();
				int w = Math.Round(Math.Sqrt(n));
				if (w * w != n || w < 2)
					continue;
				for (int iz; iz < w; iz++)
				{
					int gz = ty * stepZ + iz;
					if (Z_FLIP)
						gz = vz - 1 - gz;
					float pz = mins[2] + gz * cell;
					for (int ix; ix < w; ix++)
						tile[iz * w + ix] = Sample(mins[0] + (tx * stepX + ix) * cell, pz);
				}
				// Set wants exactly (ResX / TilesX) * (ResY / TilesY) values (128 x 128), Get returns the shared edge too (129 x 129)
				wr.Clear();
				wr.Reserve(tw * th);
				for (int oz; oz < th; oz++)
				{
					for (int ox; ox < tw; ox++)
						wr.Insert(tile[oz * w + ox]);
				}
				if (api.SetTerrainSurfaceTile(0, tx, ty, wr))
					tiles++;
				else if (api.SetTerrainSurfaceTile(0, tx, ty, tile))
					tilesFull++;
			}
		}
		api.EndTerrainAction();
		float cx = (mins[0] + maxs[0]) * 0.5;
		float cz = (mins[2] + maxs[2]) * 0.5;

		return string.Format("%1 x %2 grid (step %3 m) on %4 x %5 vertices (cell %6 m), %7/%8 tiles written", m_iCols, m_iRows, m_fStep, vx, vz, cell, tiles, tilesX * tilesZ)
			+ string.Format(" (first tile: get %1, %2 values; begin %3; centre now %4, wanted %5)", firstGet, firstCount, began, api.GetTerrainSurfaceY(cx, cz), Sample(cx, cz)) + string.Format(" (129-wide writes %1, %2 fine patch(es))", tilesFull, patches);
	}

	//------------------------------------------------------------------------------------------------
	//! bilinear, clamped to the grid
	protected float Sample(float x, float z)
	{
		for (int p; p < m_aPOff.Count(); p++)
		{
			float pst = m_aPHead[p * 5 + 2];
			int pc = m_aPHead[p * 5 + 3];
			int pr = m_aPHead[p * 5 + 4];
			float qx = (x - m_aPHead[p * 5]) / pst;
			float qz = (z - m_aPHead[p * 5 + 1]) / pst;
			if (qx < 0 || qz < 0 || qx > pc - 1 || qz > pr - 1)
				continue;
			int px = Math.Min(Math.Floor(qx), pc - 2);
			int pz = Math.Min(Math.Floor(qz), pr - 2);
			float tx = qx - px;
			float tz = qz - pz;
			int j = m_aPOff[p] + pz * pc + px;
			float pa = m_aPH[j] + (m_aPH[j + 1] - m_aPH[j]) * tx;
			float pb = m_aPH[j + pc] + (m_aPH[j + pc + 1] - m_aPH[j + pc]) * tx;
			return pa + (pb - pa) * tz;
		}
		float gx = Math.Clamp((x - m_fMinX) / m_fStep, 0, m_iCols - 1);
		float gz = Math.Clamp((z - m_fMinZ) / m_fStep, 0, m_iRows - 1);
		int x0 = Math.Min(Math.Floor(gx), m_iCols - 2);
		int z0 = Math.Min(Math.Floor(gz), m_iRows - 2);
		float fx = gx - x0;
		float fz = gz - z0;
		int i = z0 * m_iCols + x0;
		float a = m_aH[i] + (m_aH[i + 1] - m_aH[i]) * fx;
		float b = m_aH[i + m_iCols] + (m_aH[i + m_iCols + 1] - m_aH[i + m_iCols]) * fx;
		return a + (b - a) * fz;
	}

	//------------------------------------------------------------------------------------------------
	//! per patch: a line "minX minZ step cols rows", then rows lines of values (row-major, row 0 = south); missing file = no patch
	protected int LoadPatches(string file)
	{
		m_aPHead.Clear();
		m_aPH.Clear();
		m_aPOff.Clear();
		if (!FileIO.FileExists(file))
			return 0;
		FileHandle fh = FileIO.OpenFile(file, FileMode.READ);
		if (!fh)
			return 0;
		string head, line;
		array<string> parts = {};
		while (fh.ReadLine(head) >= 0)
		{
			parts.Clear();
			head.Split(" ", parts, true);
			if (parts.Count() < 5)
				break;
			int cols = parts[3].ToInt();
			int rows = parts[4].ToInt();
			if (cols < 2 || rows < 2)
				break;
			int off = m_aPH.Count();
			for (int k; k < 5; k++)
				m_aPHead.Insert(parts[k].ToFloat());
			for (int r; r < rows && fh.ReadLine(line) >= 0; r++)
			{
				parts.Clear();
				line.Split(" ", parts, true);
				foreach (string v : parts)
					m_aPH.Insert(v.ToFloat());
			}
			if (m_aPH.Count() != off + cols * rows)
			{
				m_aPH.Resize(off);
				m_aPHead.Resize(m_aPHead.Count() - 5);
				break;
			}
			m_aPOff.Insert(off);
		}
		fh.Close();
		return m_aPOff.Count();
	}

	//------------------------------------------------------------------------------------------------
	protected string Load(string file)
	{
		FileHandle fh = FileIO.OpenFile(file, FileMode.READ);
		if (!fh)
			return "cannot read " + file;

		string line;
		fh.ReadLine(line);
		array<string> parts = {};
		line.Split(" ", parts, true);
		if (parts.Count() < 5)
		{
			fh.Close();
			return "bad header: " + line;
		}
		m_fMinX = parts[0].ToFloat();
		m_fMinZ = parts[1].ToFloat();
		m_fStep = parts[2].ToFloat();
		m_iCols = parts[3].ToInt();
		m_iRows = parts[4].ToInt();
		if (m_iCols < 2 || m_iRows < 2 || m_fStep <= 0)
		{
			fh.Close();
			return "bad header: " + line;
		}

		m_aH.Clear();
		while (fh.ReadLine(line) >= 0 && m_aH.Count() < m_iCols * m_iRows)
		{
			parts.Clear();
			line.Split(" ", parts, true);
			foreach (string p : parts)
				m_aH.Insert(p.ToFloat());
		}
		fh.Close();

		if (m_aH.Count() != m_iCols * m_iRows)
			return string.Format("expected %1 heights, read %2", m_iCols * m_iRows, m_aH.Count());
		return string.Empty;
	}
}

//! Manual entry point (same file as the bridge writes).
[WorkbenchPluginAttribute(name: "MapGen - Apply heightmap", category: "MapGen", wbModules: { "WorldEditor" }, awesomeFontCode: 0xF6FC)]
class MG_ApplyHeightmapPlugin : WorldEditorPlugin
{
	[Attribute("$profile:MapGen/heightmap.txt", desc: "Height grid file")]
	protected string m_sHeightmapFile;

	override void Configure()
	{
		Workbench.ScriptDialog("MapGen - Apply heightmap", "", this);
	}

	override void Run()
	{
		MG_HeightmapApplier applier = new MG_HeightmapApplier();
		Print("[MapGen] heightmap: " + applier.Apply(m_sHeightmapFile), LogLevel.NORMAL);
	}
}

//! NET API entry point "MG_ApplyHeightmap" {file} -> {status, message}.
class MG_ApplyHeightmapRequest : JsonApiStruct
{
	string file;

	void MG_ApplyHeightmapRequest()
	{
		RegV("file");
	}
}

class MG_ApplyHeightmapResponse : JsonApiStruct
{
	string status;
	string message;

	void MG_ApplyHeightmapResponse()
	{
		RegV("status");
		RegV("message");
	}
}

class MG_ApplyHeightmap : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new MG_ApplyHeightmapRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		MG_ApplyHeightmapRequest req = MG_ApplyHeightmapRequest.Cast(request);
		MG_ApplyHeightmapResponse resp = new MG_ApplyHeightmapResponse();
		string file = req.file;
		if (!file)
			file = "$profile:MapGen/heightmap.txt";

		MG_HeightmapApplier applier = new MG_HeightmapApplier();
		resp.message = applier.Apply(file);
		resp.status = "ok";
		if (resp.message.StartsWith("error:"))
			resp.status = "error";
		Print("[MapGen] (bridge) heightmap: " + resp.message, LogLevel.NORMAL);
		return resp;
	}
}
#endif
