#ifdef WORKBENCH
//! Terrain tests, part 2 (around the part-1 plateau):
//! - a flag pole named MG_TerrainTestMarker at the centre, to find the zone quickly;
//! - surface paint: one Rock_01 square brush on the plateau (ModifyLayers);
//! - user-shape heights: a 32x32 pyramid stamped east of the plateau (ModifyHeightMapUserShape),
//!   heights sampled before/after to learn how the array maps to world and to height.
//! Undo with Ctrl+Z.
[WorkbenchPluginAttribute(name: "MapGen - Terrain write test 2", category: "MapGen", wbModules: { "WorldEditor" }, awesomeFontCode: 0xF6FC)]
class MG_TerrainTest2Plugin : WorldEditorPlugin
{
	[Attribute("2081 0 2112", desc: "Plateau centre (X/Z)")]
	protected vector m_vTestCentre;

	[Attribute("Terrains/Common/Surfaces/Rock_01.emat", desc: "Surface material to paint")]
	protected string m_sMaterial;

	override void Configure()
	{
		Workbench.ScriptDialog("MapGen terrain test 2", "", this);
	}

	override void Run()
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		WorldEditorAPI api = worldEditor.GetApi();
		float x = m_vTestCentre[0];
		float z = m_vTestCentre[2];

		PlaceMarker(api, x, z);
		// Paint(api, x - 60, z); // crashes: GetOrLoadMaterial(res, 0) -> "Material cannot create clone for 0x0 creation flags"
		UserShape(api, x + 250, z);
		UserShapeAdd(api, x + 150, z);
	}

	//------------------------------------------------------------------------------------------------
	//! ADD mode: are the array values metres added to the ground (scaled by fAdd)?
	//! Same 32x32 pyramid, peak value 20, fAdd 1. Expected if so: centre +20 m, border +0.
	protected void UserShapeAdd(WorldEditorAPI api, float x, float z)
	{
		int n = 32;
		array<float> shape = {};
		for (int r; r < n; r++)
		{
			for (int c; c < n; c++)
			{
				float dx = Math.AbsFloat(c - (n - 1) * 0.5) / ((n - 1) * 0.5);
				float dz = Math.AbsFloat(r - (n - 1) * 0.5) / ((n - 1) * 0.5);
				shape.Insert(20 * (1 - Math.Max(dx, dz)));
			}
		}

		TerrainToolDesc_HeightAdd desc = new TerrainToolDesc_HeightAdd();
		desc.fAdd = 1;
		desc.fOuterSize = 32;
		desc.fInnerSizePercent = 100;

		Print("[MapGen] add before: " + Profile(api, x, z), LogLevel.NORMAL);
		bool begun = api.BeginTerrainAction(TerrainToolType.HEIGHT_ADD, "MapGen usershape add test");
		api.ModifyHeightMapUserShape(x, z, FilterMorphOperation.ADD, desc, shape, UserShapeFilter.BILINEAR);
		api.EndTerrainAction("MapGen usershape add test");
		Print("[MapGen] add after:  " + Profile(api, x, z) + " begin=" + begun, LogLevel.NORMAL);
	}

	//------------------------------------------------------------------------------------------------
	protected void PlaceMarker(WorldEditorAPI api, float x, float z)
	{
		for (int i, count = api.GetEditorEntityCount(); i < count; i++)
		{
			if (api.GetEditorEntity(i).GetName() == "MG_TerrainTestMarker")
				return;
		}

		ResourceName flag = Workbench.GetResourceName("Prefabs/Structures/Military/Flags/FlagPole_01/FlagPole_01_empty.et");
		vector pos = Vector(x, api.GetTerrainSurfaceY(x, z), z);
		api.BeginEntityAction("MapGen terrain test marker");
		IEntitySource src = api.CreateEntity(flag, "MG_TerrainTestMarker", api.GetCurrentEntityLayerId(), null, pos, vector.Zero);
		api.EndEntityAction();
		Print(string.Format("[MapGen] marker %1 at %2 -> %3", flag, pos, src != null), LogLevel.NORMAL);
	}

	//------------------------------------------------------------------------------------------------
	protected void Paint(WorldEditorAPI api, float x, float z)
	{
		Material material = Material.GetOrLoadMaterial(Workbench.GetResourceName(m_sMaterial), 0);
		if (!material)
		{
			Print("[MapGen] paint: cannot load " + m_sMaterial, LogLevel.ERROR);
			return;
		}

		TerrainToolDesc_LayerAdd desc = new TerrainToolDesc_LayerAdd();
		desc.pMaterial = material;
		desc.fAddNormalized = 1;
		desc.fOuterSize = 16;
		desc.fInnerSizePercent = 100;

		bool begun = api.BeginTerrainAction(TerrainToolType.SURFACE_PAINT, "MapGen paint test");
		api.ModifyLayers(x, z, FilterMorphOperation.ADD, desc, FilterMorphShape.SQUARE, FilterMorphLerpFunc.LINEAR);
		api.EndTerrainAction("MapGen paint test");
		Print(string.Format("[MapGen] paint %1 at %2 %3, begin=%4", m_sMaterial, x, z, begun), LogLevel.NORMAL);
	}

	//------------------------------------------------------------------------------------------------
	protected void UserShape(WorldEditorAPI api, float x, float z)
	{
		// 32x32 pyramid, 0 at the border, 1 at the centre
		int n = 32;
		array<float> shape = {};
		for (int r; r < n; r++)
		{
			for (int c; c < n; c++)
			{
				float dx = Math.AbsFloat(c - (n - 1) * 0.5) / ((n - 1) * 0.5);
				float dz = Math.AbsFloat(r - (n - 1) * 0.5) / ((n - 1) * 0.5);
				shape.Insert(1 - Math.Max(dx, dz));
			}
		}

		TerrainToolDesc_HeightExact desc = new TerrainToolDesc_HeightExact();
		desc.fExactHeight = 60;
		desc.fOuterSize = 32;
		desc.fInnerSizePercent = 100;

		Print("[MapGen] usershape before: " + Profile(api, x, z), LogLevel.NORMAL);
		bool begun = api.BeginTerrainAction(TerrainToolType.HEIGHT_EXACT, "MapGen usershape test");
		api.ModifyHeightMapUserShape(x, z, FilterMorphOperation.EXACT, desc, shape, UserShapeFilter.BILINEAR);
		api.EndTerrainAction("MapGen usershape test");
		Print("[MapGen] usershape after:  " + Profile(api, x, z) + " begin=" + begun, LogLevel.NORMAL);
	}

	//! heights along +X from the centre, every 8 m up to 96 m
	protected string Profile(WorldEditorAPI api, float x, float z)
	{
		string s;
		for (int d; d <= 96; d += 8)
			s += string.Format("%1=%2 ", d, api.GetTerrainSurfaceY(x + d, z).ToString(-1, 1));
		return s;
	}
}
#endif
