#ifdef WORKBENCH
//! NET API entry point "MG_Status": lets the web bridge check that the Workbench answers and whether a world is
//! open, with nothing but this addon loaded.
class MG_StatusResponse : JsonApiStruct
{
	string status;
	string world;
	bool terrain;

	void MG_StatusResponse()
	{
		RegV("status");
		RegV("world");
		RegV("terrain");
	}
}

class MG_Status : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new JsonApiStruct();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		MG_StatusResponse resp = new MG_StatusResponse();
		resp.status = "ok";
		WorldEditor we = Workbench.GetModule(WorldEditor);
		if (!we)
			return resp;
		WorldEditorAPI api = we.GetApi();
		if (api && api.GetWorld())
		{
			resp.world = "open";
			vector mins, maxs;
			resp.terrain = we.GetTerrainBounds(mins, maxs);
		}
		return resp;
	}
}
#endif
