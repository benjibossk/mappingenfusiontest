#ifdef WORKBENCH
//! Makes the terrain keep its surface list: the Paint panel list is only saved into <world>.terr
//! once a surface has actually been painted. This stamps one tiny dot of every surface found under
//! m_sFolder, each in its own block (5 surfaces max per block), in the sea of the south-west corner.
//! Now only EXPORTS the list (see Run): script painting crashed.
[WorkbenchPluginAttribute(name: "MapGen - Register surfaces", category: "MapGen", wbModules: { "WorldEditor" }, awesomeFontCode: 0xF53F)]
class MG_RegisterSurfacesPlugin : WorldEditorPlugin
{
	[Attribute("Terrains/Common/Surfaces/", desc: "Paint every .emat whose path contains this")]
	protected string m_sFolder;


	protected ref array<ResourceName> m_aFound = {};

	override void Configure()
	{
		Workbench.ScriptDialog("MapGen - Register surfaces", "", this);
	}

	//------------------------------------------------------------------------------------------------
	protected void OnFound(ResourceName resName, string filePath = "")
	{
		if (resName.Contains(m_sFolder))
			m_aFound.Insert(resName);
	}

	//------------------------------------------------------------------------------------------------
	override void Run()
	{
		m_aFound.Clear();
		Workbench.SearchResources(OnFound, { "emat" });
		m_aFound.Sort();
		Print(string.Format("[MapGen] surfaces found: %1", m_aFound.Count()), LogLevel.NORMAL);
		if (m_aFound.IsEmpty())
			return;

		// Painting from script crashes (GetOrLoadMaterial flags undocumented): export the list instead,
		// the bridge writes it into the MATS chunk of <world>.terr while the world is closed.
		FileHandle f = FileIO.OpenFile("$profile:MapGen/surfaces.txt", FileMode.WRITE);
		if (!f)
		{
			Print("[MapGen] cannot write $profile:MapGen/surfaces.txt", LogLevel.ERROR);
			return;
		}
		foreach (ResourceName res : m_aFound)
			f.WriteLine(res);
		f.Close();
		Print(string.Format("[MapGen] %1 surfaces written to $profile:MapGen/surfaces.txt", m_aFound.Count()), LogLevel.NORMAL);
	}
}
#endif
