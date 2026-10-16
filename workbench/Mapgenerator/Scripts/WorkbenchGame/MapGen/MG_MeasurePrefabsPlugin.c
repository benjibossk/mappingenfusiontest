#ifdef WORKBENCH
//! Measures prefabs for the web tool (villages, bridges, ports): each prefab of the given folders is
//! created for a moment, its local bounding box read, then deleted. Writes
//! $profile:MapGen/prefabs.txt, one line per prefab: "{GUID}path minX minY minZ maxX maxY maxZ".
[WorkbenchPluginAttribute(name: "MapGen - Measure prefabs", category: "MapGen", wbModules: { "WorldEditor" }, awesomeFontCode: 0xF545)]
class MG_MeasurePrefabsPlugin : WorldEditorPlugin
{
	[Attribute("$ArmaReforger:Prefabs/Structures/Houses;$ArmaReforger:Prefabs/Structures/Farm;$ArmaReforger:Prefabs/Structures/Industrial;$ArmaReforger:Prefabs/Structures/Civic;$ArmaReforger:Prefabs/Structures/Commercial;$ArmaReforger:Prefabs/Structures/Infrastructure/Bridges;$ArmaReforger:Prefabs/Structures/Infrastructure/Naval", desc: "Folders to measure, separated by ;")]
	protected string m_sFolders;

	protected ref array<ResourceName> m_aFound = {};

	//------------------------------------------------------------------------------------------------
	protected void OnFound(ResourceName resName, string filePath = "")
	{
		m_aFound.Insert(resName);
	}

	//------------------------------------------------------------------------------------------------
	override void Run()
	{
		WorldEditor we = Workbench.GetModule(WorldEditor);
		WorldEditorAPI api = we.GetApi();
		if (!api)
			return;
		m_aFound.Clear();
		array<string> folders = {};
		m_sFolders.Split(";", folders, true);
		foreach (string folder : folders)
			Workbench.SearchResources(OnFound, { "et" }, null, folder.Trim(), true);
		Print("[MapGen] measuring " + m_aFound.Count() + " prefabs", LogLevel.NORMAL);

		FileHandle f = FileIO.OpenFile("$profile:MapGen/prefabs.txt", FileMode.WRITE);
		if (!f)
			return;
		bool own = api.BeginEntityAction("MapGen measure prefabs");
		int done;
		foreach (ResourceName res : m_aFound)
		{
			IEntitySource src = api.CreateEntity(res, "", api.GetCurrentEntityLayerId(), null, Vector(0, 2000, 0), vector.Zero);
			if (!src)
				continue;
			IEntity ent = api.SourceToEntity(src);
			if (ent)
			{
				vector mins, maxs;
				ent.GetBounds(mins, maxs);
				f.WriteLine(string.Format("%1 %2 %3 %4 %5 %6 %7", res, mins[0], mins[1], mins[2], maxs[0], maxs[1], maxs[2]));
				done++;
			}
			api.DeleteEntity(src);
		}
		if (own)
			api.EndEntityAction();
		f.Close();
		Print("[MapGen] measured " + done + " prefabs -> $profile:MapGen/prefabs.txt", LogLevel.NORMAL);
	}

	//------------------------------------------------------------------------------------------------
	override void Configure()
	{
		Workbench.ScriptDialog("MapGen measure prefabs", "Folders to measure (exact paths, ; separated)", this);
	}
}
#endif
