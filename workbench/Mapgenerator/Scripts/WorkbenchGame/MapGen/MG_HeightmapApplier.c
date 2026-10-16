#ifdef WORKBENCH
//! Writes a whole height grid into the open terrain with ModifyHeightMapUserShape (no import dialog).
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

	//------------------------------------------------------------------------------------------------
	//! Returns a report; starts with "error:" on failure.
	string Apply(string file)
	{
		string err = Load(file);
		if (err)
			return "error: " + err;

		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		WorldEditorAPI api = worldEditor.GetApi();
		vector mins, maxs;
		if (!api || !worldEditor.GetTerrainBounds(mins, maxs))
			return "error: no world / terrain open in edit mode";

		int vx = api.GetTerrainResolutionX(0);
		int vz = api.GetTerrainResolutionY(0);
		if (vx < 2 || vz < 2)
			return "error: terrain resolution unknown";
		float cell = (maxs[0] - mins[0]) / (vx - 1);

		float hMin = m_aH[0];
		float hMax = m_aH[0];
		foreach (float h : m_aH)
		{
			hMin = Math.Min(hMin, h);
			hMax = Math.Max(hMax, h);
		}

		int n = 2 * HALF + 1;
		array<float> ones = {};
		ones.Resize(n * n);
		for (int i; i < n * n; i++)
			ones[i] = 1;

		TerrainToolDesc_HeightExact desc = new TerrainToolDesc_HeightExact();
		desc.fOuterSize = HALF;
		desc.fInnerSizePercent = 100;

		int stamps;
		api.BeginTerrainAction(TerrainToolType.HEIGHT_EXACT, "MapGen heightmap");
		for (int cz = HALF; cz - HALF < vz - 1; cz += 2 * HALF)
		{
			for (int cx = HALF; cx - HALF < vx - 1; cx += 2 * HALF)
			{
				float wx = mins[0] + cx * cell;
				float wz = mins[2] + cz * cell;

				// pass 1: flatten to the minimum
				desc.fExactHeight = hMin;
				api.ModifyHeightMapUserShape(wx, wz, FilterMorphOperation.EXACT, desc, ones, UserShapeFilter.BILINEAR);

				if (hMax - hMin < 0.01)
					continue;

				// pass 2: weights towards the maximum
				array<float> w = {};
				w.Resize(n * n);
				for (int ix; ix < n; ix++)
				{
					float px = wx + (ix - HALF) * cell;
					for (int iz; iz < n; iz++)
					{
						int jz = iz;
						if (Z_FLIP)
							jz = n - 1 - iz;
						float pz = wz + (jz - HALF) * cell;
						w[ix * n + iz] = (Sample(px, pz) - hMin) / (hMax - hMin);
					}
				}
				desc.fExactHeight = hMax;
				api.ModifyHeightMapUserShape(wx, wz, FilterMorphOperation.EXACT, desc, w, UserShapeFilter.BILINEAR);
				stamps++;
			}
		}
		api.EndTerrainAction("MapGen heightmap");

		return string.Format("%1 x %2 grid (step %3 m) on %4 x %5 vertices (cell %6 m), %7 stamps, heights %8 .. %9 m",
			m_iCols, m_iRows, m_fStep, vx, vz, cell, stamps, hMin, hMax);
	}

	//------------------------------------------------------------------------------------------------
	//! bilinear, clamped to the grid
	protected float Sample(float x, float z)
	{
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
