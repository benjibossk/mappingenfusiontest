#ifdef WORKBENCH
//! Calibration of ModifyHeightMapUserShape: how an n x n array lands on terrain vertices.
//! Stamps an EXACT ramp (weight = column / (n-1), H = 100) on a flat area, then prints the height
//! of every vertex around it, along X (row through the centre) and along Z (column through the centre).
//! Read: which vertex gets array[0] and array[n-1], and whether n = 2 * fOuterSize + 1 maps 1:1.
[WorkbenchPluginAttribute(name: "MapGen - Stamp calibration", category: "MapGen", wbModules: { "WorldEditor" }, awesomeFontCode: 0xF545)]
class MG_StampCalibratePlugin : WorldEditorPlugin
{
	[Attribute("1000 0 1000", desc: "Centre (X/Z), on flat ground")]
	protected vector m_vCalCentre;

	[Attribute("4", desc: "fOuterSize")]
	protected float m_fOuter;

	[Attribute("9", desc: "Array size n")]
	protected int m_iN;

	override void Configure()
	{
		Workbench.ScriptDialog("MapGen - Stamp calibration", "", this);
	}

	override void Run()
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		WorldEditorAPI api = worldEditor.GetApi();
		float x = m_vCalCentre[0];
		float z = m_vCalCentre[2];
		float cell = 2;

		// ramp along X (columns), and a Z marker: row 0 gets +0.001 so rows can be told apart is overkill;
		// instead the Z profile uses a second stamp further away with a ramp along rows
		array<float> rampX = {};
		array<float> rampZ = {};
		for (int r; r < m_iN; r++)
		{
			for (int c; c < m_iN; c++)
			{
				rampX.Insert(c / (m_iN - 1.0));
				rampZ.Insert(r / (m_iN - 1.0));
			}
		}

		TerrainToolDesc_HeightExact desc = new TerrainToolDesc_HeightExact();
		desc.fExactHeight = 100;
		desc.fOuterSize = m_fOuter;
		desc.fInnerSizePercent = 100;

		// flag poles to find the two stamps
		ResourceName flag = Workbench.GetResourceName("Prefabs/Structures/Military/Flags/FlagPole_01/FlagPole_01_empty.et");
		api.BeginEntityAction("MapGen calibration markers");
		api.CreateEntity(flag, "MG_CalMarker_X", api.GetCurrentEntityLayerId(), null, Vector(x, api.GetTerrainSurfaceY(x, z), z), vector.Zero);
		api.CreateEntity(flag, "MG_CalMarker_Z", api.GetCurrentEntityLayerId(), null, Vector(x + 100, api.GetTerrainSurfaceY(x + 100, z), z), vector.Zero);
		api.EndEntityAction();

		bool begun = api.BeginTerrainAction(TerrainToolType.HEIGHT_EXACT, "MapGen stamp calibration");
		api.ModifyHeightMapUserShape(x, z, FilterMorphOperation.EXACT, desc, rampX, UserShapeFilter.BILINEAR);
		api.ModifyHeightMapUserShape(x + 100, z, FilterMorphOperation.EXACT, desc, rampZ, UserShapeFilter.BILINEAR);
		api.EndTerrainAction("MapGen stamp calibration");

		int span = m_fOuter + 3;
		string sx = "[MapGen] cal X (cells from centre=h):";
		string sz = "[MapGen] cal Z (cells from centre=h):";
		for (int i = -span; i <= span; i++)
		{
			sx += string.Format(" %1=%2", i, api.GetTerrainSurfaceY(x + i * cell, z).ToString(-1, 2));
			sz += string.Format(" %1=%2", i, api.GetTerrainSurfaceY(x + 100, z + i * cell).ToString(-1, 2));
		}
		Print(string.Format("[MapGen] cal n=%1 outer=%2 begin=%4 base=%3", m_iN, m_fOuter, api.GetTerrainSurfaceY(x - 50, z), begun), LogLevel.NORMAL);
		Print(sx, LogLevel.NORMAL);
		Print(sz, LogLevel.NORMAL);
	}
}
#endif
