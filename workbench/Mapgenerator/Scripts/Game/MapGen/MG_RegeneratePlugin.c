#ifdef WORKBENCH
//! Test plugin: forces generators on shapes named "MG_*" to (re)generate.
//! Shapes created from files/MCP do not fire generator events; this mimics the
//! Vector Tool "Snap to terrain" edit (re-setting each point at terrain height).
[WorkbenchPluginAttribute(name: "MapGen - Regenerate MG_ shapes", category: "MapGen", wbModules: { "WorldEditor" }, awesomeFontCode: 0xF1BB)]
class MG_RegeneratePlugin : WorldEditorPlugin
{
	[Attribute("MG_", desc: "Only shapes whose name starts with this prefix")]
	protected string m_sPrefix;

	[Attribute("1", desc: "Also call RegenerateForest(true) on forest generators")]
	protected bool m_bForceForest;

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

		array<IEntitySource> shapes = {};
		for (int i, count = api.GetEditorEntityCount(); i < count; i++)
		{
			IEntitySource src = api.GetEditorEntity(i);
			if (src && src.GetName().StartsWith(m_sPrefix) && src.GetClassName().Contains("ShapeEntity"))
				shapes.Insert(src);
		}

		int touchedPoints, forests, others;
		bool ownsAction = api.BeginEntityAction("MapGen regenerate");

		foreach (IEntitySource shapeSrc : shapes)
		{
			vector origin;
			shapeSrc.Get("coords", origin);

			BaseContainerList points = shapeSrc.GetObjectArray("Points");
			if (!points)
				continue;

			for (int p, pCount = points.Count(); p < pCount; p++)
			{
				vector local;
				points.Get(p).Get("Position", local);

				// snap to terrain: local Y = terrain height - shape origin Y
				float terrainY = api.GetTerrainSurfaceY(origin[0] + local[0], origin[2] + local[2]);
				local[1] = terrainY - origin[1];

				array<ref ContainerIdPathEntry> path = { new ContainerIdPathEntry("Points", p) };
				api.SetVariableValue(shapeSrc, path, "Position", string.Format("%1 %2 %3", local[0], local[1], local[2]));
				touchedPoints++;
			}

			ShapeEntity shape = ShapeEntity.Cast(api.SourceToEntity(shapeSrc));
			if (!shape)
				continue;

			vector mins, maxs;
			shape.GetWorldBounds(mins, maxs);
			array<vector> updateMins = { mins - "10 10 10" };
			array<vector> updateMaxs = { maxs + "10 10 10" };

			for (int c, cCount = shapeSrc.GetNumChildren(); c < cCount; c++)
			{
				IEntitySource childSrc = shapeSrc.GetChild(c).ToEntitySource();
				IEntity child = api.SourceToEntity(childSrc);

				ForestGeneratorEntity forest = ForestGeneratorEntity.Cast(child);
				if (forest)
				{
					if (m_bForceForest)
					{
						forest.MG_ForceRegenerate();
						forests++;
					}
					continue;
				}

				// other generators (prefab/hedge, lake, road...): replay the shape events
				GeneratorBaseEntity generator = GeneratorBaseEntity.Cast(child);
				if (generator)
				{
					generator.OnShapeInit(shapeSrc, shape);

					// OnShapeInit may recreate the generator entity: fetch it again
					generator = GeneratorBaseEntity.Cast(api.SourceToEntity(childSrc));
					if (generator)
						generator.OnShapeChanged(shapeSrc, shape, updateMins, updateMaxs);

					PrefabGeneratorEntity prefabGen = PrefabGeneratorEntity.Cast(api.SourceToEntity(childSrc));
					if (prefabGen)
						Print("[MapGen] " + shapeSrc.GetName() + " PG: " + prefabGen.MG_DebugState(), LogLevel.NORMAL);
					else
						Print("[MapGen] " + shapeSrc.GetName() + " child " + childSrc.GetClassName(), LogLevel.NORMAL);
					others++;
				}
			}
		}

		if (ownsAction)
			api.EndEntityAction();

		Print(string.Format("[MapGen] %1 shapes, %2 points snapped, %3 forests forced, %4 other generators", shapes.Count(), touchedPoints, forests, others), LogLevel.NORMAL);
	}

	//------------------------------------------------------------------------------------------------
	override void Configure()
	{
		Workbench.ScriptDialog("MapGen regenerate", "", this);
	}
}
#endif
