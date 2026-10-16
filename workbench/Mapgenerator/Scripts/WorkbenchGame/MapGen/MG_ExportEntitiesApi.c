#ifdef WORKBENCH
//! NET API entry point "MG_ExportEntities": lists what already stands in the open world, so the web map
//! can show it (locked) and keep new roads / villages off it. Read only, no trace.
//! File $profile:MapGen/entities.txt, one line per object:
//!   E <prefab> <x> <z> <yaw> <minX> <minZ> <maxX> <maxZ>     root prefab entity, world AABB
//!   S <generator classes, | separated or -> <closed 0/1> <origin x z> <x z x z ...>     shape, world points
//! Children (generated trees, building parts) are skipped: the generator / the parent stands for them.
class MG_ExportEntitiesResponse : JsonApiStruct
{
	string status;
	string message;
	string file;

	void MG_ExportEntitiesResponse()
	{
		RegV("status");
		RegV("message");
		RegV("file");
	}
}

class MG_ExportEntities : NetApiHandler
{
	static const string FILE = "$profile:MapGen/entities.txt";
	protected ref array<IEntity> m_aFound = {};

	override JsonApiStruct GetRequest()
	{
		return new JsonApiStruct();
	}

	protected bool OnEntity(IEntity e)
	{
		if (!e.GetParent())
			m_aFound.Insert(e);
		return true;
	}

	protected static string N(float v)
	{
		return v.ToString(-1, 1);
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		MG_ExportEntitiesResponse resp = new MG_ExportEntitiesResponse();
		resp.status = "error";
		WorldEditor we = Workbench.GetModule(WorldEditor);
		if (!we)
		{
			resp.message = "WorldEditor module not loaded";
			return resp;
		}
		WorldEditorAPI api = we.GetApi();
		vector mins, maxs;
		if (!api || !api.GetWorld() || !we.GetTerrainBounds(mins, maxs))
		{
			resp.message = "no world / terrain open in edit mode";
			return resp;
		}
		mins[1] = -10000;
		maxs[1] = 10000;
		m_aFound.Clear();
		api.GetWorld().QueryEntitiesByAABB(mins, maxs, OnEntity);

		FileIO.MakeDirectory("$profile:MapGen");
		FileHandle fh = FileIO.OpenFile(FILE, FileMode.WRITE);
		if (!fh)
		{
			resp.message = "cannot write " + FILE;
			return resp;
		}
		int nE, nS;
		array<vector> pts = {};
		foreach (IEntity e : m_aFound)
		{
			ShapeEntity shape = ShapeEntity.Cast(e);
			if (shape)
			{
				string gens;
				IEntity child = e.GetChildren();
				while (child)
				{
					if (!gens.IsEmpty())
						gens += "|";
					gens += child.ClassName();
					child = child.GetSibling();
				}
				if (gens.IsEmpty())
					gens = "-";
				pts.Clear();
				shape.GetPointsPositions(pts);
				if (pts.Count() < 2)
					continue;
				string closed = "0";
				if (shape.IsClosed())
					closed = "1";
				vector so = e.GetOrigin();
				string line = string.Format("S %1 %2 %3 %4", gens, closed, N(so[0]), N(so[2]));
				foreach (vector p : pts)
				{
					vector w = e.CoordToParent(p);
					line += " " + N(w[0]) + " " + N(w[2]);
				}
				fh.WriteLine(line);
				nS++;
				continue;
			}
			EntityPrefabData pd = e.GetPrefabData();
			if (!pd)
				continue;
			string pn = pd.GetPrefabName();
			if (pn.IsEmpty())
				continue;
			vector bmin, bmax;
			e.GetWorldBounds(bmin, bmax);
			vector o = e.GetOrigin();
			fh.WriteLine(string.Format("E %1 %2 %3 %4 %5 %6 %7 %8", pn, N(o[0]), N(o[2]), N(e.GetYawPitchRoll()[0]), N(bmin[0]), N(bmin[2]), N(bmax[0]), N(bmax[2])));
			nE++;
		}
		fh.Close();
		m_aFound.Clear();

		resp.status = "ok";
		resp.file = FILE;
		resp.message = string.Format("%1 objects, %2 shapes", nE, nS);
		Print("[MapGen] (bridge) entities: " + resp.message, LogLevel.NORMAL);
		return resp;
	}
}
#endif
