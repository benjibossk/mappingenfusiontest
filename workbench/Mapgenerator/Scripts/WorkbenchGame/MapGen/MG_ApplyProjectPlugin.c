#ifdef WORKBENCH
//! mapgen.json, written by the reforger-mapper web tool (docs/ARCHITECTURE.md).
//! JSON keys are the member names below.
class MG_ProjectShape : JsonApiStruct
{
	string id;
	string kind;			//!< "polyline" or "spline" (roads)
	bool closed;
	ref array<float> points = {};	//!< world X/Z pairs
	string generator;		//!< "{GUID}path.et"
	ref array<string> paramKeys = {};	//!< generator properties (RoadWidth, AdjustHeightMap...)
	ref array<string> paramValues = {};
	ref array<float> lift = {};	//!< optional metres above the terrain per point (water level); empty = on the terrain

	void MG_ProjectShape()
	{
		RegV("id");
		RegV("kind");
		RegV("closed");
		RegV("points");
		RegV("generator");
		RegV("paramKeys");
		RegV("paramValues");
		RegV("lift");
	}
}

//! single prefab placed on the terrain (road signs...)
class MG_ProjectEntity : JsonApiStruct
{
	string id;
	string prefab;		//!< "{GUID}path.et" or bare path (resolved)
	float x;
	float z;
	int yaw;			//!< degrees (int: JsonApiStruct leaves a float field at 0 when the JSON value is an integer)
	int ycm;			//!< absolute height in cm (bridges); 0 = on the terrain

	void MG_ProjectEntity()
	{
		RegV("id");
		RegV("prefab");
		RegV("x");
		RegV("z");
		RegV("yaw");
		RegV("ycm");
	}
}

class MG_Project : JsonApiStruct
{
	int version;
	ref array<ref MG_ProjectShape> shapes = {};
	ref array<ref MG_ProjectEntity> entities = {};
	ref array<float> remove = {};	//!< X/Z pairs: origins of objects already in the world to delete (taken over or removed in the web map)

	void MG_Project()
	{
		RegV("version");
		RegV("shapes");
		RegV("entities");
		RegV("remove");
	}
}

//! Shared by the plugin (menu) and the MG_ApplyProject NET API handler (web bridge).
class MG_ProjectApplier
{
	//! Layer id by name in the current sub-scene, created on first use (keeps "default" for hand-placed things)
	static int Layer(WorldEditorAPI api, string name)
	{
		int sub = api.GetCurrentSubScene();
		int id = api.GetSubsceneLayerId(sub, name);
		if (id > 0 && api.GetSubsceneLayerPath(sub, id) == name)
			return id;
		string path = api.CreateSubsceneLayer(sub, name);
		id = api.GetSubsceneLayerId(sub, path);
		if (id <= 0)
		{
			Print("[MapGen] cannot create layer " + name + ", using the current one", LogLevel.WARNING);
			return api.GetCurrentEntityLayerId();
		}
		return id;
	}

	//! ROAD_x spline -> MG_Roads, its barriers/posts -> MG_RoadFurniture, any other shape -> one layer
	//! per generator family, from the folder after WEGenerators/ (MG_Forest, MG_Hedges, MG_Water...)
	static string LayerFor(string id, string generator)
	{
		if (id.StartsWith("ROAD_"))
		{
			if (id.Contains("_BAR_") || id.Contains("_POST_"))
				return "MG_RoadFurniture";
			return "MG_Roads";
		}
		int at = generator.IndexOf("WEGenerators/");
		if (at < 0)
			return "MG_Shapes";
		string rest = generator.Substring(at + 13, generator.Length() - at - 13);
		int slash = rest.IndexOf("/");
		if (slash <= 0)
			return "MG_Shapes";
		return "MG_" + rest.Substring(0, slash);
	}

	//! Returns a one-line report; it starts with "error:" on failure.
	//! debug labels (shape id floating over its middle), so screenshots tell which object is which
	static ref array<string> s_aLabels = {}; //!< "id x y z" for MG_LabelsPlugin

	static void Label(WorldEditorAPI api, MG_ProjectShape shape)
	{
		int n = shape.points.Count() / 2;
		if (n == 0)
			return;
		float x, z;
		if (shape.closed)
		{
			for (int i = 0; i < n; i++)
			{
				x += shape.points[i * 2] / n;
				z += shape.points[i * 2 + 1] / n;
			}
		}
		else
		{
			x = shape.points[(n / 2) * 2];
			z = shape.points[(n / 2) * 2 + 1];
		}
		float y = api.GetTerrainSurfaceY(x, z) + 6;
		s_aLabels.Insert(shape.id + " " + x.ToString() + " " + y.ToString() + " " + z.ToString());
	}

	//! writes the labels file and redraws the labels
	static void FlushLabels(WorldEditorAPI api)
	{
		FileHandle f = FileIO.OpenFile("$profile:MapGen/labels.txt", FileMode.WRITE);
		if (!f)
			return;
		foreach (string l : s_aLabels)
			f.WriteLine(l);
		f.Close();
		MG_LabelsPlugin.Refresh();
	}

	static string Apply(string projectFile)
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
			return "error: WorldEditor module not loaded";

		WorldEditorAPI api = worldEditor.GetApi();
		if (!api)
			return "error: World Editor not in edit mode";

		if (!FileIO.FileExists(projectFile))
			return "error: project file not found: " + projectFile;

		MG_Project project = new MG_Project();
		project.LoadFromFile(projectFile);
		// big projects come in parts (mapgen.1.json, mapgen.2.json...): the JSON reader fails on large files
		string stem = projectFile.Substring(0, projectFile.Length() - 5);
		int part = 1;
		while (FileIO.FileExists(stem + "." + part.ToString() + ".json"))
		{
			MG_Project more = new MG_Project();
			more.LoadFromFile(stem + "." + part.ToString() + ".json");
			foreach (MG_ProjectShape ms : more.shapes)
				project.shapes.Insert(ms);
			foreach (MG_ProjectEntity me : more.entities)
				project.entities.Insert(me);
			part++;
		}
		Print(string.Format("[MapGen] read %1 file(s): %2 shapes, %3 objects", part, project.shapes.Count(), project.entities.Count()));

		api.ToggleGeneratorEvents(true);
		bool ownsAction = api.BeginEntityAction("MapGen apply project");

		// Replace the previous objects of each family sent (ROAD_*, WATER_*, SET_*) at top level (children go with their parent)
		array<string> families = {};
		foreach (MG_ProjectShape fs : project.shapes)
		{
			if (fs.id.StartsWith("ROAD_") && !families.Contains("ROAD_"))
				families.Insert("ROAD_");
			if (fs.id.StartsWith("WATER_") && !families.Contains("WATER_"))
				families.Insert("WATER_");
			if (fs.id.StartsWith("SET_") && !families.Contains("SET_"))
				families.Insert("SET_");
		}
		// settlements: buildings (entities) plus their lanes and footpaths (shapes SET_x_LANE_n / SET_x_PATH_n)
		foreach (MG_ProjectEntity fe : project.entities)
		{
			if (fe.id.StartsWith("SET_") && !families.Contains("SET_"))
				families.Insert("SET_");
		}
		array<IEntitySource> old = {};
		for (int i = api.GetEditorEntityCount() - 1; i >= 0; i--)
		{
			IEntitySource src = api.GetEditorEntity(i);
			if (!src || src.GetParent())
				continue;
			foreach (string fam : families)
			{
				if (src.GetName().StartsWith(fam))
				{
					old.Insert(src);
					break;
				}
			}
		}
		// objects of the world taken over / removed in the web map: root entities at those origins
		for (int ri = api.GetEditorEntityCount() - 1; ri >= 0 && !project.remove.IsEmpty(); ri--)
		{
			IEntitySource rsrc = api.GetEditorEntity(ri);
			if (!rsrc || rsrc.GetParent() || old.Contains(rsrc))
				continue;
			IEntity ent = api.SourceToEntity(rsrc);
			if (!ent)
				continue;
			vector o = ent.GetOrigin();
			for (int k = 0; k + 1 < project.remove.Count(); k += 2)
			{
				if (Math.AbsFloat(o[0] - project.remove[k]) < 0.3 && Math.AbsFloat(o[2] - project.remove[k + 1]) < 0.3)
				{
					old.Insert(rsrc);
					break;
				}
			}
		}
		// a shape still selected in the spline tool while it is deleted leaves the tool on a dead entity (crash on the next click)
		if (!old.IsEmpty())
			api.ClearEntitySelection();
		foreach (IEntitySource src : old)
			api.DeleteEntity(src);

		// report of what was really built, line per shape / object, compared by the bridge with what was sent
		// S <id> <ok|FAIL> <points sent> <points built> <generator children>   E <id> <ok|FAIL> <x> <z>
		FileHandle rep = FileIO.OpenFile("$profile:MapGen/built.txt", FileMode.WRITE);
		int created;
		s_aLabels.Clear();
		foreach (MG_ProjectShape shape : project.shapes)
		{
			IEntitySource shapeMade = MG_ShapeBuilder.Create(api, shape.id, shape.points, shape.closed, shape.generator, shape.kind == "spline", shape.paramKeys, shape.paramValues, Layer(api, LayerFor(shape.id, shape.generator)), shape.lift);
			if (shapeMade)
				created++;
			if (rep)
			{
				int nPts = 0;
				int nKids = 0;
				string state = "FAIL";
				if (shapeMade)
				{
					state = "ok";
					BaseContainerList ptList = shapeMade.GetObjectArray("Points");
					if (ptList)
						nPts = ptList.Count();
					nKids = shapeMade.GetNumChildren();
				}
				rep.WriteLine(string.Format("S %1 %2 %3 %4 %5", shape.id, state, shape.points.Count() / 2, nPts, nKids));
			}
			Label(api, shape);
		}
		FlushLabels(api);

		int placed;
		int layer = -1;
		if (project.entities.Count() > 0)
			layer = Layer(api, "MG_RoadSigns");
		foreach (MG_ProjectEntity ent : project.entities)
		{
			string prefab = ent.prefab;
			if (!prefab.StartsWith("{"))
				prefab = Workbench.GetResourceName(prefab);
			vector pos = Vector(ent.x, 0, ent.z);
			pos[1] = api.GetTerrainSurfaceY(ent.x, ent.z);
			if (ent.ycm != 0)
				pos[1] = ent.ycm * 0.01;
			IEntitySource made = api.CreateEntity(prefab, ent.id, layer, null, pos, vector.Zero);
			if (rep)
			{
				string est = "FAIL";
				if (made)
					est = "ok";
				rep.WriteLine(string.Format("E %1 %2 %3 %4", ent.id, est, ent.x, ent.z));
			}
			if (made)
			{
				// the angles argument of CreateEntity is ignored here: set the yaw explicitly.
				// StaticModelEntity (e.g. eroded banks) has no "angles": it uses angleX/Y/Z
				string rot = "0 " + ent.yaw.ToString() + " 0";
				if (ent.id.Contains("_BANK_")) // banks follow the slope; buildings stay upright (height sent by the site)
					rot = SlopeAngles(api, ent.x, ent.z, ent.yaw);
				api.SetVariableValue(made, null, "angles", rot);
				// some prefabs (buildings) keep their height relative to the terrain: the live origin then
				// ends up at ground + asked. Measure the offset and store the height that lands on pos.
				IEntity placedEnt = api.SourceToEntity(made);
				if (placedEnt)
				{
					vector got = placedEnt.GetOrigin();
					float off = got[1] - pos[1];
					if (Math.AbsFloat(off) > 0.05)
						api.SetVariableValue(made, null, "coords", string.Format("%1 %2 %3", pos[0], pos[1] - off, pos[2]));
				}
				if (ent.id.StartsWith("SET_"))
				{
					// debug (floating houses): asked height vs what the source and the live entity hold
					vector coords;
					made.Get("coords", coords);
					vector org = "0 0 0";
					IEntity live = api.SourceToEntity(made);
					if (live)
						org = live.GetOrigin();
					IEntitySource par = made.GetParent();
					string parName = "none";
					if (par)
						parName = par.GetName();
					Print(string.Format("[MapGen] %1 ground %2 asked %3 coords %4 origin %5 parent %6 rot %7", ent.id, api.GetTerrainSurfaceY(ent.x, ent.z), pos[1], coords, org, parName, rot), LogLevel.NORMAL);
				}
				if (placed < 3 || ent.id.Contains("_BANK_") && placed % 20 == 0)
				{
					// debug: what the entity really holds after setting the yaw
					float ay;
					vector an;
					made.Get("angleY", ay);
					made.Get("angles", an);
					// heading of the river at that spot (nearest segment of its shape), same convention as yaw
					string river = "-";
					int cut = ent.id.IndexOf("_BANK_");
					if (cut > 0)
					{
						string rid = ent.id.Substring(0, cut);
						foreach (MG_ProjectShape rs : project.shapes)
						{
							if (rs.id != rid)
								continue;
							float bestD = 1e12;
							for (int q = 0; q + 3 < rs.points.Count(); q += 2)
							{
								float mx = (rs.points[q] + rs.points[q + 2]) * 0.5 - ent.x;
								float mz = (rs.points[q + 1] + rs.points[q + 3]) * 0.5 - ent.z;
								if (mx * mx + mz * mz < bestD)
								{
									bestD = mx * mx + mz * mz;
									float hd = Math.Atan2(rs.points[q + 2] - rs.points[q], rs.points[q + 3] - rs.points[q + 1]) * Math.RAD2DEG;
									river = string.Format("%1 heading %2 deg (segment %3)", rid, Math.Round(hd), q / 2);
								}
							}
						}
					}
					Print(string.Format("[MapGen] yaw check %1 (%2) at %3 %4: wanted %5, angleY %6, angles %7, river %8", ent.id, made.GetClassName(), ent.x, ent.z, ent.yaw, ay, an, river));
				}
				placed++;
			}
			else
				Print("[MapGen] cannot place " + ent.prefab, LogLevel.ERROR);
		}

		if (rep)
			rep.Close();
		if (ownsAction)
			api.EndEntityAction();

		return string.Format("project v%1: %7 old objects removed, %2/%3 shapes, %4/%5 objects from %6", project.version, created, project.shapes.Count(), placed, project.entities.Count(), projectFile, old.Count());
	}
}

[WorkbenchPluginAttribute(name: "MapGen - Apply project", category: "MapGen", wbModules: { "WorldEditor" }, awesomeFontCode: 0xF56F)]
class MG_ApplyProjectPlugin : WorldEditorPlugin
{
	[Attribute("$profile:MapGen/mapgen.json", desc: "Project file written by the web tool")]
	protected string m_sProjectFile;

	//------------------------------------------------------------------------------------------------
	override void Run()
	{
		Print("[MapGen] " + MG_ProjectApplier.Apply(m_sProjectFile), LogLevel.NORMAL);
	}

	//------------------------------------------------------------------------------------------------
	override void Configure()
	{
		Workbench.ScriptDialog("MapGen apply project", "", this);
	}
}
#endif

//! "pitch yaw roll" that keeps `yaw` but lays the prefab flat on the terrain slope (banks).
//! Pitch/roll straight from the slope along the prefab's own axes; the editor's X/Z angles turn the
//! other way than Math3D.MatrixToAngles assumes (checked in the editor), hence the minus signs.
string SlopeAngles(WorldEditorAPI api, float x, float z, float yaw)
{
	float d = 4;
	float r = yaw * Math.DEG2RAD;
	float fx = Math.Sin(r), fz = Math.Cos(r); // prefab +Z (towards the land)
	float sF = (api.GetTerrainSurfaceY(x + fx * d, z + fz * d) - api.GetTerrainSurfaceY(x - fx * d, z - fz * d)) / (2 * d);
	float sR = (api.GetTerrainSurfaceY(x + fz * d, z - fx * d) - api.GetTerrainSurfaceY(x - fz * d, z + fx * d)) / (2 * d);
	float pitch = -Math.Atan2(sF, 1) * Math.RAD2DEG;
	float roll = -Math.Atan2(sR, 1) * Math.RAD2DEG;
	return pitch.ToString() + " " + yaw.ToString() + " " + roll.ToString();
}
