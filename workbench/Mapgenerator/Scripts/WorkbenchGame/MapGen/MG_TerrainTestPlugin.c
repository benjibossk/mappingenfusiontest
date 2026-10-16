#ifdef WORKBENCH
//! Test: stamps one exact-height square brush, then samples heights around it to learn the
//! brush semantics (is fOuterSize a radius or a width, does fInnerSizePercent=100 remove falloff).
//! Undo with Ctrl+Z (one terrain history point).
[WorkbenchPluginAttribute(name: "MapGen - Terrain write test", category: "MapGen", wbModules: { "WorldEditor" }, awesomeFontCode: 0xF6FC)]
class MG_TerrainTestPlugin : WorldEditorPlugin
{
	[Attribute("2081 0 2112", desc: "Brush centre (X/Z)")]
	protected vector m_vTestCentre;

	[Attribute("48", desc: "Exact height to set, m")]
	protected float m_fHeight;

	[Attribute("64", desc: "Brush fOuterSize")]
	protected float m_fSize;

	override void Configure()
	{
		Workbench.ScriptDialog("MapGen terrain test", "", this);
	}

	override void Run()
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		WorldEditorAPI api = worldEditor.GetApi();
		float x = m_vTestCentre[0];
		float z = m_vTestCentre[2];

		Print("[MapGen] before: " + Profile(api, x, z), LogLevel.NORMAL);

		TerrainToolDesc_HeightExact desc = new TerrainToolDesc_HeightExact();
		desc.fExactHeight = m_fHeight;
		desc.fOuterSize = m_fSize;
		desc.fInnerSizePercent = 100;
		desc.fAngle = 0;

		if (!api.BeginTerrainAction(TerrainToolType.HEIGHT_EXACT, "MapGen terrain test"))
		{
			Print("[MapGen] BeginTerrainAction failed", LogLevel.ERROR);
			return;
		}
		api.ModifyHeightMap(x, z, FilterMorphOperation.EXACT, desc, FilterMorphShape.SQUARE, FilterMorphLerpFunc.LINEAR);
		api.EndTerrainAction("MapGen terrain test");

		Print("[MapGen] after:  " + Profile(api, x, z), LogLevel.NORMAL);
	}

	//! heights along +X from the centre at 0, 20, ... 300 m
	protected string Profile(WorldEditorAPI api, float x, float z)
	{
		string s;
		for (int d; d <= 300; d += 20)
			s += string.Format("%1m=%2 ", d, api.GetTerrainSurfaceY(x + d, z).ToString(-1, 1));
		return s;
	}
}
#endif
