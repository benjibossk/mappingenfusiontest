#ifdef WORKBENCH
//! Read-only probe: prints the values of the terrain-brush enums (not documented in the API dump).
[WorkbenchPluginAttribute(name: "MapGen - Terrain probe", category: "MapGen", wbModules: { "WorldEditor" }, awesomeFontCode: 0xF6FC)]
class MG_TerrainProbePlugin : WorldEditorPlugin
{
	override void Run()
	{
		PrintEnum(FilterMorphOperation);
		PrintEnum(FilterMorphShape);
		PrintEnum(FilterMorphLerpFunc);
		PrintEnum(UserShapeFilter);
		PrintEnum(TerrainToolType);

		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		WorldEditorAPI api = worldEditor.GetApi();
		Print(string.Format("[MapGen] terrain resolution %1 x %2", api.GetTerrainResolutionX(0), api.GetTerrainResolutionY(0)), LogLevel.NORMAL);
	}

	protected void PrintEnum(typename e)
	{
		string line = "[MapGen] enum " + e.ToString() + ":";
		for (int i, count = e.GetVariableCount(); i < count; i++)
		{
			int value;
			e.GetVariableValue(null, i, value);
			line += string.Format(" %1=%2", e.GetVariableName(i), value);
		}
		Print(line, LogLevel.NORMAL);
	}
}
#endif
