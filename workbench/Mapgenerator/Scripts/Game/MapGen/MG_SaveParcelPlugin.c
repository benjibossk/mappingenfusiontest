#ifdef WORKBENCH
//! "Enregistrer la sélection comme parcelle": the selected entities become one parcel of the reforger-mapper
//! library (a fenced garden with its house, shed, trees and props; a cemetery; a yard...). Nothing is modified.
//! - main object = the selected entity with the biggest footprint (the house); its yaw is the parcel's frame:
//!   +Z = the main building's front = the access road side (tick Flip if the house turns its back to the road)
//! - positions relative to the bounding centre of the selection, y = height above the ground, yaw relative
//! - written to $profile:MapGen/parcels/<name>.json; the bridge lists them (GET /parcels) and the web tool
//!   adds them to its library ("My parcels (Workbench)").
[WorkbenchPluginAttribute(name: "Enregistrer la sélection comme parcelle", category: "MapGen", wbModules: { "WorldEditor" }, awesomeFontCode: 0xF0C7)]
class MG_SaveParcelPlugin : WorldEditorPlugin
{
	[Attribute("parcelle", desc: "Nom de la parcelle (nom du fichier, lettres / chiffres / _ -)")]
	protected string m_sName;

	[Attribute("0", UIWidgets.ComboBox, "Catégorie", "", ParamEnumArray.FromEnum(MG_EParcelCategory))]
	protected MG_EParcelCategory m_eCategory;

	[Attribute("0", desc: "Le bâtiment principal tourne le dos à la route (retourne le cadre de 180°)")]
	protected bool m_bFlip;

	[Attribute("1", desc: "La parcelle a une façade sur route (alignée sur la route la plus proche quand on la pose)")]
	protected bool m_bRoadFront;

	//------------------------------------------------------------------------------------------------
	protected static string PrefabOf(IEntity e)
	{
		EntityPrefabData pd = e.GetPrefabData();
		if (!pd)
			return "";
		return pd.GetPrefabName();
	}

	//------------------------------------------------------------------------------------------------
	protected static float Footprint(IEntity e)
	{
		vector mins, maxs;
		e.GetBounds(mins, maxs);
		return (maxs[0] - mins[0]) * (maxs[2] - mins[2]);
	}

	//------------------------------------------------------------------------------------------------
	protected static string Num(float v)
	{
		return (Math.Round(v * 100) / 100).ToString();
	}

	//------------------------------------------------------------------------------------------------
	protected static float Wrap(float a)
	{
		while (a > 180)
			a -= 360;
		while (a <= -180)
			a += 360;
		return a;
	}

	//------------------------------------------------------------------------------------------------
	protected static string CategoryName(MG_EParcelCategory c)
	{
		if (c == MG_EParcelCategory.farm)
			return "farm";
		if (c == MG_EParcelCategory.cemetery)
			return "cemetery";
		if (c == MG_EParcelCategory.industrial)
			return "industrial";
		if (c == MG_EParcelCategory.fuel)
			return "fuel";
		if (c == MG_EParcelCategory.roadside)
			return "roadside";
		if (c == MG_EParcelCategory.allotment)
			return "allotment";
		if (c == MG_EParcelCategory.sport)
			return "sport";
		if (c == MG_EParcelCategory.custom)
			return "custom";
		return "garden";
	}

	//------------------------------------------------------------------------------------------------
	//! world point -> parcel frame (origin = main object, +Z = frame heading), flat X/Z
	protected static vector ToFrame(vector p, vector o, float c, float s)
	{
		float dx = p[0] - o[0];
		float dz = p[2] - o[2];
		return Vector(dx * c - dz * s, 0, dx * s + dz * c);
	}

	//------------------------------------------------------------------------------------------------
	override void Run()
	{
		WorldEditor we = Workbench.GetModule(WorldEditor);
		WorldEditorAPI api = we.GetApi();
		if (!api || !api.GetWorld())
			return;

		array<IEntity> found = {};
		for (int i = 0; i < api.GetSelectedEntitiesCount(); i++)
		{
			IEntity e = api.SourceToEntity(api.GetSelectedEntity(i));
			if (e && !e.GetParent() && !PrefabOf(e).IsEmpty())
				found.Insert(e);
		}
		if (found.IsEmpty())
		{
			Print("[MapGen] parcelle : rien de sélectionné (des entités issues de prefabs)", LogLevel.WARNING);
			return;
		}

		IEntity anchor = found[0];
		foreach (IEntity e : found)
		{
			if (Footprint(e) > Footprint(anchor))
				anchor = e;
		}
		// main object first
		found.RemoveItem(anchor);
		found.InsertAt(anchor, 0);

		vector a = anchor.GetYawPitchRoll();
		float heading = a[0];
		if (m_bFlip)
			heading = heading + 180;
		// frame: local x = dx cos h - dz sin h, local z = dx sin h + dz cos h (+Z = heading)
		float rad = heading * Math.DEG2RAD;
		float c = Math.Cos(rad);
		float s = Math.Sin(rad);
		vector o = anchor.GetOrigin();

		// bounding box of the selection in the frame (world bounds of every entity, corners projected)
		float x0 = 1e9;
		float x1 = -1e9;
		float z0 = 1e9;
		float z1 = -1e9;
		foreach (IEntity e : found)
		{
			vector mins, maxs;
			e.GetWorldBounds(mins, maxs);
			for (int k = 0; k < 4; k++)
			{
				float wx = mins[0];
				if (k == 1 || k == 2)
					wx = maxs[0];
				float wz = mins[2];
				if (k >= 2)
					wz = maxs[2];
				vector l = ToFrame(Vector(wx, 0, wz), o, c, s);
				x0 = Math.Min(x0, l[0]);
				x1 = Math.Max(x1, l[0]);
				z0 = Math.Min(z0, l[2]);
				z1 = Math.Max(z1, l[2]);
			}
		}
		float cx = (x0 + x1) / 2;
		float cz = (z0 + z1) / 2;

		string name = m_sName;
		if (name.IsEmpty())
			name = "parcelle_" + System.GetUnixTime().ToString();
		name.Replace("\"", "");
		name.Replace("/", "_");
		name.Replace("\\", "_");

		FileIO.MakeDirectory("$profile:MapGen");
		FileIO.MakeDirectory("$profile:MapGen/parcels");
		string path = "$profile:MapGen/parcels/" + name + ".json";
		FileHandle f = FileIO.OpenFile(path, FileMode.WRITE);
		if (!f)
		{
			Print("[MapGen] parcelle : impossible d'écrire " + path, LogLevel.ERROR);
			return;
		}
		string road = "none";
		if (m_bRoadFront)
			road = "front";
		f.WriteLine("{");
		f.WriteLine(string.Format("  \"name\": \"%1\",", name));
		f.WriteLine(string.Format("  \"category\": \"%1\",", CategoryName(m_eCategory)));
		f.WriteLine(string.Format("  \"road\": \"%1\",", road));
		f.WriteLine(string.Format("  \"where\": [%1, %2],", Num(o[0]), Num(o[2])));
		f.WriteLine(string.Format("  \"size\": {\"w\": %1, \"d\": %2},", Num(x1 - x0), Num(z1 - z0)));
		f.WriteLine("  \"items\": [");
		for (int n = 0; n < found.Count(); n++)
		{
			IEntity e = found[n];
			vector p = e.GetOrigin();
			vector l = ToFrame(p, o, c, s);
			vector r = e.GetYawPitchRoll();
			float y = p[1] - api.GetTerrainSurfaceY(p[0], p[2]);
			float yaw = Wrap(r[0] - heading);
			string sep = ",";
			if (n == found.Count() - 1)
				sep = "";
			f.WriteLine(string.Format("    {\"prefab\": \"%1\", \"x\": %2, \"y\": %3, \"z\": %4, \"yaw\": %5, \"scale\": %6}%7", PrefabOf(e), Num(l[0] - cx), Num(y), Num(l[2] - cz), Num(yaw), Num(e.GetScale()), sep));
		}
		f.WriteLine("  ]");
		f.WriteLine("}");
		f.Close();
		Print(string.Format("[MapGen] parcelle %1 : %2 objets -> %3 (%4 x %5 m)", name, found.Count(), path, Num(x1 - x0), Num(z1 - z0)), LogLevel.NORMAL);
	}

	//------------------------------------------------------------------------------------------------
	override void Configure()
	{
		Workbench.ScriptDialog("Enregistrer la sélection comme parcelle", "Nom, catégorie et orientation de la parcelle.", this);
	}
}

enum MG_EParcelCategory
{
	garden,
	farm,
	cemetery,
	industrial,
	fuel,
	roadside,
	allotment,
	sport,
	custom
}
#endif
