#ifdef WORKBENCH
//! NET API "MG_Inspect" {name}: an entity source and its children (class, prefab, a few generator/road
//! properties, runtime bounds) as text lines. Debug aid for generators that come out wrong.
class MG_InspectRequest : JsonApiStruct
{
	string name;

	void MG_InspectRequest()
	{
		RegV("name");
	}
}

class MG_InspectResponse : JsonApiStruct
{
	string text;

	void MG_InspectResponse()
	{
		RegV("text");
	}
}

class MG_Inspect : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new MG_InspectRequest();
	}

	static string Dump(WorldEditorAPI api, IEntitySource src, string indent)
	{
		string s = indent + src.GetClassName() + " '" + src.GetName() + "'";
		BaseContainer anc = src.GetAncestor();
		if (anc)
			s = s + " prefab=" + anc.GetResourceName();
		array<string> keys = { "RoadWidth", "Width", "Material", "Type", "AdjustHeightMap", "FalloffStartWidth", "RoadFalloffWidth", "RoadClearance" };
		foreach (string k : keys)
		{
			if (src.GetVarIndex(k) < 0)
				continue;
			string v;
			src.Get(k, v);
			s = s + " " + k + "=" + v;
		}
		IEntity ent = api.SourceToEntity(src);
		if (ent)
		{
			vector mins, maxs;
			ent.GetWorldBounds(mins, maxs);
			s = s + " bounds=" + mins.ToString() + ".." + maxs.ToString();
			if (ent.GetVObject())
				s = s + " vobj";
		}
		s = s + "\n";
		for (int i; i < src.GetNumChildren(); i++)
			s = s + Dump(api, src.GetChild(i), indent + "  ");
		return s;
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		MG_InspectRequest req = MG_InspectRequest.Cast(request);
		MG_InspectResponse resp = new MG_InspectResponse();
		WorldEditor we = Workbench.GetModule(WorldEditor);
		if (!we)
			return resp;
		WorldEditorAPI api = we.GetApi();
		if (!api)
			return resp;
		IEntitySource src = api.FindEntityByName(req.name);
		if (!src)
		{
			resp.text = "not found";
			return resp;
		}
		resp.text = Dump(api, src, "");
		return resp;
	}
}
#endif
