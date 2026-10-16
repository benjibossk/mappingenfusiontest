#ifdef WORKBENCH
//! Captures ready-made ensembles (house + garden, block of flats + yard, quay...) from any world, the
//! vanilla maps included, so the web tool can lay them down again as templates. Nothing is modified.
//! - Selection mode: the selected entities form one template; the biggest footprint is the anchor.
//! - Area mode: every building (prefab path matching the filter) within Radius of the camera becomes
//!   the anchor of a parcel; each other object within Margin of a building's footprint joins the
//!   nearest building.
//! One file per template in $profile:MapGen/templates/, positions in the anchor's frame (m, +Z = anchor
//! front), y = height above the ground, angles relative to the anchor.
[WorkbenchPluginAttribute(name: "MapGen - Capture templates", category: "MapGen", wbModules: { "WorldEditor" }, awesomeFontCode: 0xF030)]
class MG_CaptureTemplatePlugin : WorldEditorPlugin
{
	[Attribute("1", desc: "Area mode (all buildings around the camera); off = the current selection only")]
	protected bool m_bArea;

	[Attribute("300", UIWidgets.Slider, "Area mode: radius around the camera (m)", "50 2000 10")]
	protected float m_fRadius;

	[Attribute("10", UIWidgets.Slider, "Area mode: objects closer than this to a building's footprint join it (m)", "0 50 1")]
	protected float m_fMargin;

	[Attribute("Structures/Houses;Structures/Farm;Structures/Commercial;Structures/Civic;Structures/Industrial;Structures/Military;Structures/Infrastructure/Harbour", desc: "Area mode: prefab paths that count as buildings (; separated)")]
	protected string m_sBuildings;

	[Attribute("Pipeline;FuelTank;Shed_;Garage_;Booth;Kiosk;Toilet;Container", desc: "Area mode: prefab names never used as a parcel's main building (they join the nearest one)")]
	protected string m_sNotAnchors;

	[Attribute("60", desc: "Area mode: smallest footprint of a main building (m2)")]
	protected float m_fMinFootprint;

	[Attribute("Generator;Shape;Road;Terrain;Light;Camera;Manager;Occluder", desc: "Class names to ignore (; separated)")]
	protected string m_sSkipClasses;

	[Attribute("tpl", desc: "Prefix of the file names (e.g. the world name)")]
	protected string m_sPrefix;

	protected ref array<IEntity> m_aFound = {};
	protected ref array<string> m_aSkip = {};

	//------------------------------------------------------------------------------------------------
	protected static string PrefabOf(IEntity e)
	{
		EntityPrefabData pd = e.GetPrefabData();
		if (!pd)
			return "";
		return pd.GetPrefabName();
	}

	//------------------------------------------------------------------------------------------------
	protected bool Keep(IEntity e)
	{
		if (e.GetParent() || PrefabOf(e).IsEmpty())
			return false;
		string cls = e.ClassName();
		foreach (string s : m_aSkip)
		{
			if (cls.Contains(s))
				return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	protected bool OnEntity(IEntity e)
	{
		if (Keep(e))
			m_aFound.Insert(e);
		return true;
	}

	//------------------------------------------------------------------------------------------------
	protected static float Footprint(IEntity e)
	{
		vector mins, maxs;
		e.GetBounds(mins, maxs);
		return (maxs[0] - mins[0]) * (maxs[2] - mins[2]);
	}

	//------------------------------------------------------------------------------------------------
	//! distance from p to the anchor's local footprint rectangle (0 inside)
	protected static float DistToFootprint(IEntity anchor, vector p)
	{
		vector l = anchor.CoordToLocal(p);
		vector mins, maxs;
		anchor.GetBounds(mins, maxs);
		float dx = Math.Max(0, Math.Max(mins[0] - l[0], l[0] - maxs[0]));
		float dz = Math.Max(0, Math.Max(mins[2] - l[2], l[2] - maxs[2]));
		return Math.Sqrt(dx * dx + dz * dz);
	}

	//------------------------------------------------------------------------------------------------
	protected static string Num(float v)
	{
		return (Math.Round(v * 100) / 100).ToString();
	}

	//------------------------------------------------------------------------------------------------
	protected void Write(WorldEditorAPI api, string name, IEntity anchor, array<IEntity> items)
	{
		FileHandle f = FileIO.OpenFile("$profile:MapGen/templates/" + name + ".json", FileMode.WRITE);
		if (!f)
			return;
		vector mins, maxs;
		anchor.GetBounds(mins, maxs);
		vector a = anchor.GetYawPitchRoll();
		vector o = anchor.GetOrigin();
		f.WriteLine("{");
		f.WriteLine(string.Format("  \"name\": \"%1\",", name));
		f.WriteLine(string.Format("  \"anchor\": \"%1\",", PrefabOf(anchor)));
		f.WriteLine(string.Format("  \"where\": [%1, %2],", Num(o[0]), Num(o[2])));
		f.WriteLine(string.Format("  \"bounds\": [%1, %2, %3, %4],", Num(mins[0]), Num(mins[2]), Num(maxs[0]), Num(maxs[2])));
		f.WriteLine("  \"items\": [");
		for (int i = 0; i < items.Count(); i++)
		{
			IEntity e = items[i];
			vector p = e.GetOrigin();
			vector l = anchor.CoordToLocal(p);
			vector r = e.GetYawPitchRoll();
			float y = p[1] - api.GetTerrainSurfaceY(p[0], p[2]);
			float yaw = r[0] - a[0];
			while (yaw > 180)
				yaw -= 360;
			while (yaw <= -180)
				yaw += 360;
			string sep = ",";
			if (i == items.Count() - 1)
				sep = "";
			f.WriteLine(string.Format("    {\"p\": \"%1\", \"x\": %2, \"z\": %3, \"y\": %4, \"yaw\": %5, \"pitch\": %6, \"roll\": %7}%8", PrefabOf(e), Num(l[0]), Num(l[2]), Num(y), Num(yaw), Num(r[1]), Num(r[2]), sep));
		}
		f.WriteLine("  ]");
		f.WriteLine("}");
		f.Close();
	}

	//------------------------------------------------------------------------------------------------
	override void Run()
	{
		WorldEditor we = Workbench.GetModule(WorldEditor);
		WorldEditorAPI api = we.GetApi();
		if (!api || !api.GetWorld())
			return;
		FileIO.MakeDirectory("$profile:MapGen/templates");
		m_aSkip.Clear();
		m_sSkipClasses.Split(";", m_aSkip, true);
		m_aFound.Clear();

		if (!m_bArea)
		{
			for (int i = 0; i < api.GetSelectedEntitiesCount(); i++)
			{
				IEntity e = api.SourceToEntity(api.GetSelectedEntity(i));
				if (e && Keep(e))
					m_aFound.Insert(e);
			}
			if (m_aFound.IsEmpty())
			{
				Print("[MapGen] capture: nothing selected", LogLevel.WARNING);
				return;
			}
			IEntity anchor = m_aFound[0];
			foreach (IEntity e : m_aFound)
			{
				if (Footprint(e) > Footprint(anchor))
					anchor = e;
			}
			string name = string.Format("%1_%2_%3", m_sPrefix, FilePath.StripExtension(FilePath.StripPath(PrefabOf(anchor))), System.GetUnixTime());
			Write(api, name, anchor, m_aFound);
			Print(string.Format("[MapGen] captured %1 objects -> $profile:MapGen/templates/%2.json", m_aFound.Count(), name), LogLevel.NORMAL);
			return;
		}

		vector cam[4];
		api.GetWorld().GetCurrentCamera(cam);
		vector c = cam[3];
		api.GetWorld().QueryEntitiesByAABB(c - Vector(m_fRadius, 10000, m_fRadius), c + Vector(m_fRadius, 10000, m_fRadius), OnEntity);

		array<string> filters = {};
		m_sBuildings.Split(";", filters, true);
		array<string> notAnchors = {};
		m_sNotAnchors.Split(";", notAnchors, true);
		array<IEntity> buildings = {};
		array<IEntity> others = {};
		foreach (IEntity e : m_aFound)
		{
			vector p = e.GetOrigin();
			if ((p[0] - c[0]) * (p[0] - c[0]) + (p[2] - c[2]) * (p[2] - c[2]) > m_fRadius * m_fRadius)
				continue;
			string pn = PrefabOf(e);
			bool isBuilding = false;
			foreach (string flt : filters)
			{
				if (pn.Contains(flt))
					isBuilding = true;
			}
			foreach (string na : notAnchors)
			{
				if (pn.Contains(na))
					isBuilding = false;
			}
			if (isBuilding && Footprint(e) >= m_fMinFootprint)
				buildings.Insert(e);
			else
				others.Insert(e);
		}

		// each other object joins the nearest building footprint within the margin
		array<ref array<IEntity>> parcels = {};
		foreach (IEntity b : buildings)
		{
			array<IEntity> one = { b };
			parcels.Insert(one);
		}
		foreach (IEntity e : others)
		{
			int best = -1;
			float bestD = m_fMargin;
			for (int i = 0; i < buildings.Count(); i++)
			{
				float d = DistToFootprint(buildings[i], e.GetOrigin());
				if (d <= bestD)
				{
					bestD = d;
					best = i;
				}
			}
			if (best >= 0)
				parcels[best].Insert(e);
		}

		int stamp = System.GetUnixTime();
		for (int i = 0; i < buildings.Count(); i++)
		{
			string name = string.Format("%1_%2_%3_%4", m_sPrefix, FilePath.StripExtension(FilePath.StripPath(PrefabOf(buildings[i]))), stamp, i);
			Write(api, name, buildings[i], parcels[i]);
		}
		Print(string.Format("[MapGen] captured %1 parcels (%2 objects around them) within %3 m -> $profile:MapGen/templates/", buildings.Count(), m_aFound.Count(), m_fRadius), LogLevel.NORMAL);
	}

	//------------------------------------------------------------------------------------------------
	override void Configure()
	{
		Workbench.ScriptDialog("MapGen capture templates", "Area mode captures every building around the camera with its garden; otherwise the selection becomes one template.", this);
	}
}
#endif
