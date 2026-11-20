#ifdef WORKBENCH
//! NET API entry point "MG_ListMaterials": tells the bridge which world is open, so it can read the surface
//! materials declared in that world's .terr (MATS chunk). The script API has no reader for painted layer
//! weights (only TerrainToolDesc_LayerAdd to paint), so per-material coverage is NOT returned: coverage = false.
class MG_ListMaterialsResponse : JsonApiStruct
{
	string world;
	bool terrain;
	bool coverage;
	string note;

	void MG_ListMaterialsResponse()
	{
		RegV("world");
		RegV("terrain");
		RegV("coverage");
		RegV("note");
	}
}

class MG_ListMaterials : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new JsonApiStruct();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		MG_ListMaterialsResponse resp = new MG_ListMaterialsResponse();
		resp.coverage = false;
		resp.note = "painted coverage not exposed by the script API; declared list read from the .terr by the bridge";
		WorldEditor we = Workbench.GetModule(WorldEditor);
		if (!we)
			return resp;
		WorldEditorAPI api = we.GetApi();
		if (!api || !api.GetWorld())
			return resp;
		resp.world = SCR_WorldEditorToolHelper.GetWorldPath();
		vector mins, maxs;
		resp.terrain = we.GetTerrainBounds(mins, maxs);
		return resp;
	}
}
#endif
