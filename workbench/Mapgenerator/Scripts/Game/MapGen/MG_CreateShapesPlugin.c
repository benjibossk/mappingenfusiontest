#ifdef WORKBENCH
//! Test plugin: builds shapes the way they are made by hand in the World Editor —
//! a bare PolylineShapeEntity (origin at terrain height, points relative and following
//! the terrain) with the generator prefab placed as its child.
[WorkbenchPluginAttribute(name: "MapGen - Create test shapes", category: "MapGen", wbModules: { "WorldEditor" }, awesomeFontCode: 0xF5EE)]
class MG_CreateShapesPlugin : WorldEditorPlugin
{
	[Attribute("2600 0 2000", desc: "Where the test shapes are created (X/Z, Y ignored)")]
	protected vector m_vOrigin;

	//------------------------------------------------------------------------------------------------
	override void Run()
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
			return;

		WorldEditorAPI api = worldEditor.GetApi();
		if (!api)
			return;

		api.ToggleGeneratorEvents(true);
		bool ownsAction = api.BeginEntityAction("MapGen create test shapes");

		vector o = m_vOrigin;
		CreateShape(api, "MG2_Forest", o, { "0 0 0", "150 0 0", "170 0 120", "60 0 160", "-10 0 90" }, true,
			"Prefabs/WEGenerators/Forest/FG_Forest_Pine1.et");
		CreateShape(api, "MG2_Hedge", o + "0 0 250", { "0 0 0", "60 0 20", "130 0 10", "200 0 50" }, false,
			"Prefabs/WEGenerators/PG_Vegetation_CorylusBushline.et");
		CreateShape(api, "MG2_Lake", o + "-500 0 500", { "0 0 0", "0 0 60", "80 0 70", "90 0 -10" }, true,
			"Prefabs/WEGenerators/Water/Lake/LG_Lake_01.et");

		if (ownsAction)
			api.EndEntityAction();
	}

	//------------------------------------------------------------------------------------------------
	protected void CreateShape(WorldEditorAPI api, string name, vector pos, array<vector> points, bool closed, string generatorPath)
	{
		pos[1] = api.GetTerrainSurfaceY(pos[0], pos[2]);

		IEntitySource shapeSrc = api.CreateEntity("PolylineShapeEntity", name, api.GetCurrentEntityLayerId(), null, pos, vector.Zero);
		if (!shapeSrc)
		{
			Print("[MapGen] cannot create shape " + name, LogLevel.ERROR);
			return;
		}

		if (closed)
			api.SetVariableValue(shapeSrc, null, "IsClosed", "1");

		for (int p, count = points.Count(); p < count; p++)
		{
			vector local = points[p];
			local[1] = api.GetTerrainSurfaceY(pos[0] + local[0], pos[2] + local[2]) - pos[1];

			api.CreateObjectArrayVariableMember(shapeSrc, null, "Points", "ShapePoint", p);
			array<ref ContainerIdPathEntry> path = { new ContainerIdPathEntry("Points", p) };
			api.SetVariableValue(shapeSrc, path, "Position", string.Format("%1 %2 %3", local[0], local[1], local[2]));
		}

		ResourceName generator = Workbench.GetResourceName(generatorPath);
		IEntitySource genSrc = api.CreateEntity(generator, "", api.GetCurrentEntityLayerId(), shapeSrc, vector.Zero, vector.Zero);

		Print(string.Format("[MapGen] %1: %2 points, generator %3 -> %4", name, points.Count(), generator, genSrc != null), LogLevel.NORMAL);
	}
}
#endif
