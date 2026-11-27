#ifdef WORKBENCH
//! Deleting and naming entities without being caught by duplicate names.
//! Root cause (2026-11-26): the World Editor resolves an entity by its NAME inside its delete action, so when two
//! sources share a name (TOWN_ never cleared, PARCEL_ fences of two sends), DeleteEntities removed one of them, or
//! none, and silently kept the others (668 refused on one send). Every source is first renamed to a name nobody else
//! has, then the whole list goes in one DeleteEntities. New objects whose name is already taken get a suffix.
class MG_WorldClean
{
	static const string DEL_PREFIX = "MGDEL_";
	static int s_iSerial;

	//! renames every source to a unique MGDEL_ name, deletes them in one call; returns how many are still there
	static int DeleteSources(WorldEditorAPI api, array<IEntitySource> list)
	{
		if (!list || list.IsEmpty())
			return 0;
		api.ClearEntitySelection();
		int stamp = System.GetTickCount();
		foreach (IEntitySource src : list)
		{
			s_iSerial++;
			api.RenameEntity(src, DEL_PREFIX + stamp.ToString() + "_" + s_iSerial.ToString());
		}
		api.DeleteEntities(list);
		int left;
		for (int i = api.GetEditorEntityCount() - 1; i >= 0; i--)
		{
			IEntitySource s = api.GetEditorEntity(i);
			if (s && s.GetName().StartsWith(DEL_PREFIX))
				left++;
		}
		return left;
	}

	//! names of every root entity now in the world
	static void RootNames(WorldEditorAPI api, set<string> names)
	{
		for (int i = api.GetEditorEntityCount() - 1; i >= 0; i--)
		{
			IEntitySource s = api.GetEditorEntity(i);
			if (s && !s.GetParent() && s.GetName() != "")
				names.Insert(s.GetName());
		}
	}

	//! gives `made` a name not in `names` (its own when free), records it; returns the name kept
	static string MakeUnique(WorldEditorAPI api, IEntitySource made, string wanted, set<string> names)
	{
		if (!made || wanted == "")
			return wanted;
		string name = wanted;
		int k = 1;
		while (names.Contains(name))
		{
			k++;
			name = wanted + "_u" + k.ToString();
		}
		if (name != wanted || made.GetName() != wanted)
			api.RenameEntity(made, name);
		names.Insert(name);
		if (name != wanted)
			Print("[MapGen] name " + wanted + " already taken, created as " + name, LogLevel.WARNING);
		return name;
	}

	//! root sources whose name is shared with another root source; keepOne leaves the last one of each name
	static int CollectDuplicates(WorldEditorAPI api, array<IEntitySource> found, bool keepOne, out int groups)
	{
		map<string, ref array<IEntitySource>> byName = new map<string, ref array<IEntitySource>>();
		int count = api.GetEditorEntityCount();
		for (int i = 0; i < count; i++)
		{
			IEntitySource s = api.GetEditorEntity(i);
			if (!s || s.GetParent() || s.GetName() == "")
				continue;
			array<IEntitySource> l;
			if (!byName.Find(s.GetName(), l))
			{
				l = {};
				byName.Set(s.GetName(), l);
			}
			l.Insert(s);
		}
		int total;
		groups = 0;
		foreach (string n, array<IEntitySource> g : byName)
		{
			if (g.Count() < 2)
				continue;
			groups++;
			total += g.Count();
			int last = g.Count();
			if (keepOne)
				last = g.Count() - 1;
			for (int j = 0; j < last; j++)
				found.Insert(g[j]);
		}
		return total;
	}
}

class MG_PurgeDuplicatesRequest : JsonApiStruct
{
	bool all;	//!< true: delete every member of a duplicated name; false: keep the last one of each

	void MG_PurgeDuplicatesRequest()
	{
		RegV("all");
	}
}

class MG_PurgeDuplicatesResponse : JsonApiStruct
{
	string status;
	string message;
	int groupsBefore;
	int entitiesBefore;
	int deleted;
	int refused;
	int groupsAfter;
	int entitiesAfter;

	void MG_PurgeDuplicatesResponse()
	{
		RegV("status");
		RegV("message");
		RegV("groupsBefore");
		RegV("entitiesBefore");
		RegV("deleted");
		RegV("refused");
		RegV("groupsAfter");
		RegV("entitiesAfter");
	}
}

//! NET API "MG_PurgeDuplicates": one-time cleanup of the root entities sharing a name
class MG_PurgeDuplicates : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new MG_PurgeDuplicatesRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		MG_PurgeDuplicatesRequest req = MG_PurgeDuplicatesRequest.Cast(request);
		MG_PurgeDuplicatesResponse resp = new MG_PurgeDuplicatesResponse();
		resp.status = "error";
		WorldEditor we = Workbench.GetModule(WorldEditor);
		if (!we || !we.GetApi())
		{
			resp.message = "no World Editor";
			return resp;
		}
		WorldEditorAPI api = we.GetApi();
		array<IEntitySource> list = {};
		int g;
		resp.entitiesBefore = MG_WorldClean.CollectDuplicates(api, list, !req.all, g);
		resp.groupsBefore = g;
		bool own = api.BeginEntityAction("MapGen purge duplicates");
		resp.refused = MG_WorldClean.DeleteSources(api, list);
		if (own)
			api.EndEntityAction();
		resp.deleted = list.Count() - resp.refused;
		array<IEntitySource> after = {};
		resp.entitiesAfter = MG_WorldClean.CollectDuplicates(api, after, true, g);
		resp.groupsAfter = g;
		resp.status = "ok";
		resp.message = string.Format("duplicates: %1 names / %2 entities before, %3 deleted, %4 refused, %5 names / %6 entities after", resp.groupsBefore, resp.entitiesBefore, resp.deleted, resp.refused, resp.groupsAfter, resp.entitiesAfter);
		Print("[MapGen] " + resp.message, LogLevel.NORMAL);
		return resp;
	}
}
#endif
