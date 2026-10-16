#ifdef WORKBENCH
//! Debug for screenshots: the name of every object sent by the web tool floats over it.
//! Only the objects closer than Range to the camera get a label; Run (Ctrl+Alt+Shift+L) redraws them
//! around the current camera. Labels come from $profile:MapGen/labels.txt, written on Apply.
[WorkbenchPluginAttribute(name: "MapGen - Labels", category: "MapGen", shortcut: "Ctrl+Alt+Shift+L", wbModules: { "WorldEditor" }, awesomeFontCode: 0xF02B)]
class MG_LabelsPlugin : WorldEditorPlugin
{
	[Attribute("400", UIWidgets.Slider, "Labels for objects closer than this to the camera (m)", "0 10000 10")]
	protected float m_fRange;

	[Attribute("14", UIWidgets.Slider, "Text size", "6 40 1")]
	protected float m_fSize;

	[Attribute("1", desc: "Show the labels")]
	protected bool m_bShow;

	// last settings used (Apply redraws with them); kept in a file because a script reload resets
	// the statics and the plugin instance is not rebuilt until it is used. No redraw on script reload:
	// it ran while the world was being reloaded and is suspected of the Workbench crashes.
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
		Workbench.ScriptDialog("MapGen labels", "Range, size, show/hide. Run (Ctrl+Alt+Shift+L) redraws around the camera.", this);
		Store();
		Refresh();
	}
}

#endif
