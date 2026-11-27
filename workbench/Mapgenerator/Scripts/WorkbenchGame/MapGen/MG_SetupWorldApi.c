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
		"Prefabs/Sounds/Environment/AmbientSounds_Everon.et",
		// the rest of the vanilla Entities Setup list (1_BaseWorldSetup.conf), also flagged by bridge/world-setup.mjs
		"Prefabs/Systems/Radio/RadioBroadcastManager_Everon.et",
		"Prefabs/Sounds/Music/MusicManager_Base.et",
		"Prefabs/World/Game/MapEntity.et"
	};

	//! same order as MANAGERS: entity classes that already fill the role (a hand-placed light, fog,
	//! probe or camera manager is not from the prefab: a 2nd global probe crashed the WB on load)
	static const ref array<string> MANAGER_CLASSES = {
		"GenericWorldLightEntity",
		"GenericWorldFogEntity",
		"GenericWorldPPEffect",
		"TimeAndWeatherManagerEntity",
		"EnvironmentProbeEntity|GameEnvironmentProbeEntity",
		"SCR_DestructionManager",
		"SCR_MPDestructionManager",
		"CameraManager|SCR_CameraManager",
		"BasePreloadManager|SCR_PreloadManager",
		"",
		"SoundWorld",
		"",
		"",
		"",
		"SCR_MapEntity"
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

		// terrain extent: from the terrain itself, else req.size from 0,0
		float size = req.size;
		vector mins, maxs;
		float x0 = 0;
		float z0 = 0;
		float x1 = size;
		float z1 = size;
		if (worldEditor.GetTerrainBounds(mins, maxs))
		{
			x0 = mins[0];
			z0 = mins[2];
			x1 = maxs[0];
			z1 = maxs[2];
		}
		else if (size <= 0)
		{
			resp.message = "no terrain bounds and no size";
			return resp;
		}
		size = x1 - x0;
		int moved = 0;
		int deleted = 0;
		array<string> notes = {};
		array<string> missing = {};

		bool ownsAction = api.BeginEntityAction("MapGen setup world");

		// 1. managers
		if (req.managers)
		{
			int def = LayerId(api, "default", false);
			int count = api.GetEditorEntityCount();
			foreach (int mi, string p : MANAGERS)
			{
				array<string> classes = {};
				MANAGER_CLASSES[mi].Split("|", classes, true);
				bool have = false;
				for (int i = 0; i < count && !have; i++)
				{
					IEntitySource e = api.GetEditorEntity(i);
					if (!e)
						continue;
					if (IsPrefab(e, p) || classes.Contains(e.GetClassName()))
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
					pos = ProbePos(api, x0, z0, x1, z1);
				IEntitySource made = api.CreateEntity(rn, "", def, null, pos, vector.Zero);
				if (made)
					resp.created++;
				else
					missing.Insert(p);
			}
		}

		// 2. world bounds: reuse the rocks of a previous run (moved), delete extras, create the missing
		if (req.bounds)
		{
			array<IEntitySource> kept = {};
			for (int j = 0; j < api.GetEditorEntityCount(); j++)
			{
				IEntitySource old = api.GetEditorEntity(j);
				if (!old)
					continue;
				// by name, and by layer: the name passed to CreateEntity is not always kept
				string lp = api.GetEntitySubsceneLayer(0, old);
				if (old.GetName().StartsWith(BOUNDS_PREFIX) || (lp && lp.EndsWith(BOUNDS_LAYER) && IsPrefab(old, ROCK)))
					kept.Insert(old);
			}
			while (kept.Count() > 5)
			{
				api.DeleteEntity(kept[kept.Count() - 1]);
				kept.Remove(kept.Count() - 1);
				deleted++;
			}
			float e = 1;
			array<vector> pts = { Vector(x0 + e, 0, z0 + e), Vector(x1 - e, 0, z0 + e), Vector(x0 + e, 0, z1 - e), Vector(x1 - e, 0, z1 - e), HighestPoint(api, x0, z0, x1, z1) };
			ResourceName rock;
			bool haveRock = m_mFound.Find(ROCK, rock);
			int layer = LayerId(api, BOUNDS_LAYER, true);
			for (int k = 0; k < 5; k++)
			{
				vector q = pts[k];
				q[1] = api.GetTerrainSurfaceY(q[0], q[2]);
				if (k < kept.Count())
				{
					api.SetVariableValue(kept[k], null, "coords", string.Format("%1 %2 %3", q[0], q[1], q[2]));
					moved++;
				}
				else if (haveRock)
				{
					if (api.CreateEntity(rock, BOUNDS_PREFIX + k.ToString(), layer, null, q, vector.Zero))
						resp.created++;
				}
			}
			if (!haveRock && kept.Count() < 5)
				missing.Insert(ROCK);
			notes.Insert(string.Format("bounds rocks moved %1, deleted %2", moved, deleted));
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
	protected vector HighestPoint(WorldEditorAPI api, float x0, float z0, float x1, float z1)
	{
		vector best = Vector((x0 + x1) * 0.5, -1e9, (z0 + z1) * 0.5);
		float sx = (x1 - x0) / 64;
		float sz = (z1 - z0) / 64;
		for (int r = 0; r <= 64; r++)
		{
			for (int c = 0; c <= 64; c++)
			{
				float x = x0 + c * sx;
				float z = z0 + r * sz;
				float y = api.GetTerrainSurfaceY(x, z);
				if (y > best[1])
					best = Vector(x, y, z);
			}
		}
		return best;
	}

	//------------------------------------------------------------------------------------------------
	//! land point (> 1 m above sea level) closest to the map centre, 2 m above the ground
	protected vector ProbePos(WorldEditorAPI api, float x0, float z0, float x1, float z1)
	{
		float cx = (x0 + x1) * 0.5;
		float cz = (z0 + z1) * 0.5;
		float sx = (x1 - x0) / 64;
		float sz = (z1 - z0) / 64;
		vector best = Vector(cx, api.GetTerrainSurfaceY(cx, cz) + 2, cz);
		float bestD = 1e12;
		for (int r = 0; r <= 64; r++)
		{
			for (int c = 0; c <= 64; c++)
			{
				float x = x0 + c * sx;
				float z = z0 + r * sz;
				float y = api.GetTerrainSurfaceY(x, z);
				if (y < 1)
					continue;
				float d = (x - cx) * (x - cx) + (z - cz) * (z - cz);
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
