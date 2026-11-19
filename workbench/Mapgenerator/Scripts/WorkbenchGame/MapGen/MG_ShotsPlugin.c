#ifdef WORKBENCH
//! MG_ShotsPlugin - World Editor screenshots without focus (reforger-mapper/scripts/wb-shots/).
//!
//! shots.ps1 starts a hidden Workbench (private desktop) with
//!   -gproj Mapgenerator/addon.gproj -wbModule=WorldEditor -plugin=MG_ShotsPlugin -profile <dir>
//! RunCommandline reads $profile:MapGen/shots/plan.txt, opens the world, places the editor camera
//! for every shot line, waits, writes the viewport with System.MakeScreenshot, then Workbench.Exit.
//! Run from the menu (MapGen > Shots) it shoots the same plan in the open Workbench and stays open.
//!
//! plan.txt, one directive per line (shots.ps1 writes it from shots.json):
//!   world <resource path>      opened when another world is loaded
//!   settle <ms>                wait between camera move and shot (default 600)
//!   first <ms>                 extra wait before the first shot (streaming, shaders; default 4000)
//!   shot <name> <px> <py> <pz> <tx> <ty> <tz> <agl>
//!     camera at p looking at t. agl 1 = both heights are metres above the terrain.
//! status.txt: one line per step ("ok shot <name> <file>", "error <reason>"), last line "done <shots> <failed>".
[WorkbenchPluginAttribute(name: "MapGen - Shots", description: "Takes the shots of $profile:MapGen/shots/plan.txt", category: "MapGen", wbModules: { "WorldEditor" }, awesomeFontCode: 0xF030)]
class MG_ShotsPlugin : WorldEditorPlugin
{
	protected static const string DIR = "$profile:MapGen/shots";
	protected static const int SHOT_TIMEOUT_MS = 8000;

	protected ref array<string> m_aStatus = {};
	protected int m_iStart;
	protected WorldEditorAPI m_Api;

	//------------------------------------------------------------------------------------------------
	override void RunCommandline()
	{
		int failed = Shoot();
		int code = 0;
		if (failed != 0)
			code = 1;

		Workbench.Exit(code);
	}

	//------------------------------------------------------------------------------------------------
	override void Run()
	{
		Shoot();
	}

	//------------------------------------------------------------------------------------------------
	protected void Note(string line)
	{
		m_aStatus.Insert(string.Format("%1 %2", System.GetTickCount() - m_iStart, line));
		Print("[MG_Shots] " + line, LogLevel.NORMAL);
		FileHandle f = FileIO.OpenFile(DIR + "/status.txt", FileMode.WRITE);
		if (!f)
			return;

		foreach (string s : m_aStatus)
		{
			f.WriteLine(s);
		}

		f.Close();
	}

	//------------------------------------------------------------------------------------------------
	protected string Rest(string line, int from)
	{
		string r = line.Substring(from, line.Length() - from);
		r.TrimInPlace();
		return r;
	}

	//------------------------------------------------------------------------------------------------
	protected bool SameWorld(string opened, string wanted)
	{
		if (opened.IsEmpty() || wanted.IsEmpty())
			return false;

		// compare without the {GUID} prefix and case
		string w = wanted;
		int close = w.IndexOf("}");
		if (close >= 0)
			w = w.Substring(close + 1, w.Length() - close - 1);

		string o = opened;
		o.ToLower();
		w.ToLower();
		return o.IndexOf(w) >= 0;
	}

	//------------------------------------------------------------------------------------------------
	//! \return number of failed steps
	protected int Shoot()
	{
		m_iStart = System.GetTickCount();
		m_aStatus.Clear();
		FileIO.MakeDirectory("$profile:MapGen");
		FileIO.MakeDirectory(DIR);

		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			Note("error no_world_editor");
			Note("done 0 1");
			return 1;
		}

		FileHandle plan = FileIO.OpenFile(DIR + "/plan.txt", FileMode.READ);
		if (!plan)
		{
			Note("error no_plan " + DIR + "/plan.txt");
			Note("done 0 1");
			return 1;
		}

		string world;
		int settleMs = 600;
		int firstMs = 4000;
		array<string> shots = {};
		string line;
		while (plan.ReadLine(line) >= 0)
		{
			line.TrimInPlace();
			if (line.StartsWith("world "))
				world = Rest(line, 6);
			else if (line.StartsWith("settle "))
				settleMs = Rest(line, 7).ToInt();
			else if (line.StartsWith("first "))
				firstMs = Rest(line, 6).ToInt();
			else if (line.StartsWith("shot "))
				shots.Insert(line);
		}

		plan.Close();

		m_Api = worldEditor.GetApi();
		string opened;
		if (m_Api)
			m_Api.GetWorldPath(opened);

		if (!SameWorld(opened, world))
		{
			if (world.IsEmpty() || !worldEditor.SetOpenedResource(world))
			{
				Note("error world_not_opened " + world + " (open: " + opened + ")");
				Note("done 0 1");
				return 1;
			}

			m_Api = worldEditor.GetApi();
			opened = "";
			if (m_Api)
				m_Api.GetWorldPath(opened);
		}

		if (!m_Api)
		{
			Note("error no_api");
			Note("done 0 1");
			return 1;
		}

		Note("ok world " + opened);
		Sleep(firstMs);

		int failed;
		int done;
		foreach (string s : shots)
		{
			if (TakeShot(s, settleMs))
				done++;
			else
				failed++;
		}

		Note(string.Format("done %1 %2", done, failed));
		return failed;
	}

	//------------------------------------------------------------------------------------------------
	protected bool TakeShot(string line, int settleMs)
	{
		array<string> p = {};
		line.Split(" ", p, true);
		if (p.Count() < 9)
		{
			Note("error bad_shot " + line);
			return false;
		}

		string name = p[1];
		vector cam = Vector(p[2].ToFloat(), p[3].ToFloat(), p[4].ToFloat());
		vector target = Vector(p[5].ToFloat(), p[6].ToFloat(), p[7].ToFloat());
		if (p[8] == "1")
		{
			cam[1] = cam[1] + m_Api.GetTerrainSurfaceY(cam[0], cam[2]);
			target[1] = target[1] + m_Api.GetTerrainSurfaceY(target[0], target[2]);
		}

		vector dir = target - cam;
		if (dir.Length() < 0.01)
			dir = "0 -1 0";

		dir.Normalize();
		m_Api.SetCamera(cam, dir);
		Sleep(settleMs);
		// the editor camera eases: set it again so the kept frame is the framed one
		m_Api.SetCamera(cam, dir);
		Sleep(80);

		string path = DIR + "/" + name;
		FileIO.DeleteFile(path + ".png");
		FileIO.DeleteFile(path + ".bmp");
		System.MakeScreenshot(path);

		int waited;
		string found;
		while (waited < SHOT_TIMEOUT_MS)
		{
			Sleep(50);
			waited += 50;
			if (FileIO.FileExists(path + ".png"))
				found = path + ".png";
			else if (FileIO.FileExists(path + ".bmp"))
				found = path + ".bmp";

			if (!found.IsEmpty())
				break;
		}

		if (found.IsEmpty())
		{
			Note("error no_file " + name);
			return false;
		}

		Note(string.Format("ok shot %1 %2 cam=%3,%4,%5", name, FilePath.StripPath(found), cam[0], cam[1], cam[2]));
		return true;
	}
}
#endif
