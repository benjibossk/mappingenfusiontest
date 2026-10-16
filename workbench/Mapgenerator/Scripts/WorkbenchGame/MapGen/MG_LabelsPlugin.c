#ifdef WORKBENCH
//! Debug for screenshots: the name of every object sent by the web tool floats over it.
//! Only the objects closer than Range to the camera get a label; Run (Ctrl+Shift+L) redraws them
//! around the current camera. Labels come from $profile:MapGen/labels.txt, written on Apply.
[WorkbenchPluginAttribute(name: "MapGen - Labels", category: "MapGen", shortcut: "Ctrl+Shift+L", wbModules: { "WorldEditor" }, awesomeFontCode: 0xF02B)]
class MG_LabelsPlugin : WorldEditorPlugin
{
	[Attribute("400", UIWidgets.Slider, "Labels for objects closer than this to the camera (m)", "0 10000 10")]
	protected float m_fRange;

	[Attribute("14", UIWidgets.Slider, "Text size", "6 40 1")]
	protected float m_fSize;

	[Attribute("1", desc: "Show the labels")]
	protected bool m_bShow;

	// last settings used (Apply and script reloads redraw with them); kept in a file because a
	// script reload resets the statics and the plugin instance is not rebuilt until it is used
	protected static const string SETTINGS = "$profile:MapGen/labels.cfg";
	protected static float s_fRange = 400;
	protected static float s_fSize = 14;
	protected static bool s_bShow = true;
	protected static ref array<ref DebugTextWorldSpace> s_aTexts = {};

	//------------------------------------------------------------------------------------------------
	protected static void LoadSettings()
	{
		FileHandle f = FileIO.OpenFile(SETTINGS, FileMode.READ);
		if (!f)
			return;
		string line;
		f.ReadLine(line);
		f.Close();
		array<string> p = {};
		line.Split(" ", p, true);
		if (p.Count() < 3)
			return;
		s_fRange = p[0].ToFloat();
		s_fSize = p[1].ToFloat();
		s_bShow = p[2].ToInt() != 0;
	}

	//------------------------------------------------------------------------------------------------
	static void Refresh()
	{
		LoadSettings();
		// at Workbench start-up the boot object runs before the class statics are set
		if (!s_aTexts)
			s_aTexts = {};
		s_aTexts.Clear();
		if (!s_bShow)
			return;
		WorldEditor we = Workbench.GetModule(WorldEditor);
		if (!we || !we.GetApi())
			return;
		BaseWorld world = we.GetApi().GetWorld();
		if (!world)
			return;
		FileHandle f = FileIO.OpenFile("$profile:MapGen/labels.txt", FileMode.READ);
		if (!f)
			return;
		vector cam[4];
		world.GetCurrentCamera(cam);
		float r2 = s_fRange * s_fRange;
		string line;
		while (f.ReadLine(line) >= 0)
		{
			array<string> p = {};
			line.Split(" ", p, true);
			if (p.Count() < 4)
				continue;
			vector pos = Vector(p[1].ToFloat(), p[2].ToFloat(), p[3].ToFloat());
			if (vector.DistanceSq(cam[3], pos) > r2)
				continue;
			s_aTexts.Insert(DebugTextWorldSpace.Create(world, p[0], DebugTextFlags.CENTER | DebugTextFlags.FACE_CAMERA, pos[0], pos[1], pos[2], s_fSize, 0xFFFFFF00, 0xC0000000));
		}
		f.Close();
	}

	//------------------------------------------------------------------------------------------------
	protected void Store()
	{
		s_fRange = m_fRange;
		s_fSize = m_fSize;
		s_bShow = m_bShow;
		FileHandle f = FileIO.OpenFile(SETTINGS, FileMode.WRITE);
		if (!f)
			return;
		int show = 0;
		if (m_bShow)
			show = 1;
		f.WriteLine(m_fRange.ToString() + " " + m_fSize.ToString() + " " + show.ToString());
		f.Close();
	}

	//------------------------------------------------------------------------------------------------
	override void Run()
	{
		Store();
		Refresh();
	}

	//------------------------------------------------------------------------------------------------
	override void Configure()
	{
		Workbench.ScriptDialog("MapGen labels", "Range, size, show/hide. Run (Ctrl+Shift+L) redraws around the camera.", this);
		Store();
		Refresh();
	}
}

//! redraws the labels right after a script reload (the debug texts die with the old VM)
class MG_LabelsBoot
{
	void MG_LabelsBoot()
	{
		MG_LabelsPlugin.Refresh();
	}
}
static ref MG_LabelsBoot g_MG_LabelsBoot = new MG_LabelsBoot();
#endif
