#ifdef WORKBENCH
//! NET API entry point "MG_SetupWorld": post-Apply world housekeeping (community mapping docs,
//! analyses/GDOCS_MAPPING_AUDIT.md), called by the bridge after /apply:
//!  1. base world managers: creates the vanilla prefab of each one missing, in layer "default"
//!     (Lighting, FogHaze, GenericWorldPP, TimeAndWeather, EnvProbe, Destruction, MPDestruction,
//!     CameraManager, PreloadManager, ForestSync, SoundWorld, AmbientSounds). EnvProbe goes 2 m
//!     above the land point closest to the map centre (never over water).
//!  2. world bounds: 4 small rocks at the terrain corners + 1 on the highest point, in layer
//!     "MG_Bounds" (the WE only grows its world bounds to entities: missing blocks / invisible wall).
//!  3. optional menu actions (normalMenu / bordersMenu = "Menu/Item" paths, empty = skipped):
//!     "Generate Normal Map" and "Fix block borders" are Terrain Tool panel buttons, not menu
//!     items, so by default they are left to the UIA script.
//!  4. save the world (save = true).
//! Prefabs are resolved by path at run time (Workbench.SearchResources), so no GUID is hard-coded.
class MG_SetupWorldRequest : JsonApiStruct
{
	float size;
	bool managers;
	bool bounds;
	bool save;
	string normalMenu;
	string bordersMenu;

	void MG_SetupWorldRequest()
	{
		RegV("size");
		RegV("managers");
		RegV("bounds");
		RegV("save");
		RegV("normalMenu");
		RegV("bordersMenu");
	}
}

class MG_SetupWorldResponse : JsonApiStruct
{
	string status;
	string message;
	int created;
	string missing;

	void MG_SetupWorldResponse()
	{
		RegV("status");
		RegV("message");
		RegV("created");
		RegV("missing");
	}
}

class MG_SetupWorld : NetApiHandler
{
	static const string BOUNDS_PREFIX = "MG_BOUND_";
	static const string BOUNDS_LAYER = "MG_Bounds";
	static const string ROCK = "Prefabs/Rocks/Granite/GraniteStone_01.et";

	//! the base world managers, in creation order (light first, then sky / fog / post-process)
	static const ref array<string> MANAGERS = {
		"Prefabs/World/DefaultWorld/Lighting_Default.et",
		"Prefabs/World/DefaultWorld/FogHaze_Default.et",
		"Prefabs/World/DefaultWorld/GenericWorldPP_Default.et",
		"Prefabs/World/Game/TimeAndWeatherManager.et",
		"Prefabs/World/DefaultWorld/EnvProbe_Default.et",
		"Prefabs/Systems/Destruction/DestructionManager.et",
		"Prefabs/MP/MPDestructionManager.et",
		"Prefabs/World/Game/SCR_CameraManager.et",
		"Prefabs/World/Game/PreloadManager.et",
		"Prefabs/World/Game/ForestSyncManager.et",
		"Prefabs/Sounds/SoundWorld/SoundWorld_Base.et",
		"Prefabs/Sounds/Environment/AmbientSounds_Everon.et"
	};

	protected ref map<string, ResourceName> m_mFound = new map<string, ResourceName>();

	override JsonApiStruct GetRequest()
	{
		return new MG_SetupWorldRequest();
	}

	//------------------------------------------------------------------------------------------------
	protected void OnFound(ResourceName resName, string filePath = "")
	{
		foreach (string p : MANAGERS)
		{
			if (resName.EndsWith(p))
				m_mFound.Set(p, resName);
		}
		if (resName.EndsWith(ROCK))
			m_mFound.Set(ROCK, resName);
	}

	//------------------------------------------------------------------------------------------------
	//! true if the entity or one of its prefab ancestors is `path`
	protected bool IsPrefab(IEntitySource src, string path)
	{
		BaseContainer c = src;
		int guard = 0;
		while (c && guard < 16)
		{
			string rn = c.GetResourceName();
			if (rn && rn.EndsWith(path))
				return true;
			c = c.GetAncestor();
			guard++;
		}
		return false;
	}

	//------------------------------------------------------------------------------------------------
	protected int LayerId(WorldEditorAPI api, string path, bool create)
	{
		int id = api.GetSubsceneLayerId(0, path);
		if (id < 0 && create)
		{
			api.CreateSubsceneLayer(0, path);
			id = api.GetSubsceneLayerId(0, path);
		}
		if (id < 0)
			id = api.GetCurrentEntityLayerId();
		return id;
	}

	//------------------------------------------------------------------------------------------------
	protected bool RunMenu(WorldEditor we, string path)
	{
		if (!path)
			return false;
		array<string> parts = {};
		path.Split("/", parts, true);
		if (parts.Count() < 2)
			return false;
		return we.ExecuteAction(parts);
	}

	//------------------------------------------------------------------------------------------------
	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		MG_SetupWorldRequest req = MG_SetupWorldRequest.Cast(request);
		MG_SetupWorldResponse resp = new MG_SetupWorldResponse();
		resp.status = "error";

		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			resp.message = "WorldEditor module not loaded";
			return resp;
		}
		WorldEditorAPI api = worldEditor.GetApi();
		if (!api || !api.GetWorld())
		{
			resp.message = "no world open";
			return resp;
		}

		m_mFound.Clear();
		Workbench.SearchResources(OnFound, { "et" });

		float size = req.size;
		if (size <= 0)
			size = 4096;
		array<string> notes = {};
		array<string> missing = {};

		bool ownsAction = api.BeginEntityAction("MapGen setup world");

		// 1. managers
		if (req.managers)
		{
			int def = LayerId(api, "default", false);
			int count = api.GetEditorEntityCount();
			foreach (string p : MANAGERS)
			{
				bool have = false;
				for (int i = 0; i < count && !have; i++)
				{
					IEntitySource e = api.GetEditorEntity(i);
					if (e && IsPrefab(e, p))
						have = true;
				}
				if (have)
					continue;
				ResourceName rn;
				if (!m_mFound.Find(p, rn))
				{
					missing.Insert(p);
					continue;
				}
				vector pos = vector.Zero;
				if (p.Contains("EnvProbe"))
					pos = ProbePos(api, size);
				IEntitySource made = api.CreateEntity(rn, "", def, null, pos, vector.Zero);
				if (made)
					resp.created++;
				else
					missing.Insert(p);
			}
		}

		// 2. world bounds
		if (req.bounds)
		{
			for (int j = api.GetEditorEntityCount() - 1; j >= 0; j--)
			{
				IEntitySource old = api.GetEditorEntity(j);
				if (old && old.GetName().StartsWith(BOUNDS_PREFIX))
					api.DeleteEntity(old);
			}
			ResourceName rock;
			if (m_mFound.Find(ROCK, rock))
			{
				int layer = LayerId(api, BOUNDS_LAYER, true);
				float e = 1;
				array<vector> pts = { Vector(e, 0, e), Vector(size - e, 0, e), Vector(e, 0, size - e), Vector(size - e, 0, size - e), HighestPoint(api, size) };
				int k = 0;
				foreach (vector q : pts)
				{
					q[1] = api.GetTerrainSurfaceY(q[0], q[2]);
					if (api.CreateEntity(rock, BOUNDS_PREFIX + k.ToString(), layer, null, q, vector.Zero))
						resp.created++;
					k++;
				}
			}
			else
				missing.Insert(ROCK);
		}

		if (ownsAction)
			api.EndEntityAction();

		// 3. menu actions (only if the bridge passes a menu path)
		if (req.normalMenu)
			notes.Insert("normal map: " + RunMenu(worldEditor, req.normalMenu).ToString());
		if (req.bordersMenu)
			notes.Insert("fix block borders: " + RunMenu(worldEditor, req.bordersMenu).ToString());

		// 4. save
		if (req.save)
			notes.Insert("saved: " + worldEditor.Save().ToString());

		foreach (string m : missing)
		{
			if (resp.missing)
				resp.missing += ",";
			resp.missing += m;
		}
		string joined;
		foreach (string n : notes)
			joined += " " + n + ";";
		resp.status = "ok";
		resp.message = string.Format("%1 entity(ies) created, %2 prefab(s) not found;%3", resp.created, missing.Count(), joined);
		Print("[MapGen] (bridge) setup world: " + resp.message, LogLevel.NORMAL);
		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! highest terrain point, coarse 64 x 64 scan
	protected vector HighestPoint(WorldEditorAPI api, float size)
	{
		vector best = Vector(size * 0.5, -1e9, size * 0.5);
		float step = size / 64;
		for (int r = 0; r <= 64; r++)
		{
			for (int c = 0; c <= 64; c++)
			{
				float x = c * step;
				float z = r * step;
				float y = api.GetTerrainSurfaceY(x, z);
				if (y > best[1])
					best = Vector(x, y, z);
			}
		}
		return best;
	}

	//------------------------------------------------------------------------------------------------
	//! land point (> 1 m above sea level) closest to the map centre, 2 m above the ground
	protected vector ProbePos(WorldEditorAPI api, float size)
	{
		float cx = size * 0.5;
		float step = size / 64;
		vector best = Vector(cx, api.GetTerrainSurfaceY(cx, cx) + 2, cx);
		float bestD = 1e12;
		for (int r = 0; r <= 64; r++)
		{
			for (int c = 0; c <= 64; c++)
			{
				float x = c * step;
				float z = r * step;
				float y = api.GetTerrainSurfaceY(x, z);
				if (y < 1)
					continue;
				float d = (x - cx) * (x - cx) + (z - cx) * (z - cx);
				if (d < bestD)
				{
					bestD = d;
					best = Vector(x, y + 2, z);
				}
			}
		}
		return best;
	}
}
#endif
