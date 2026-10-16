#ifdef WORKBENCH
//! NET API entry point for the reforger-mapper bridge: APIFunc "MG_ApplyProject".
//! The bridge writes the project file, then calls this to apply it to the open world.
class MG_ApplyProjectRequest : JsonApiStruct
{
	string file;

	void MG_ApplyProjectRequest()
	{
		RegV("file");
	}
}

class MG_ApplyProjectResponse : JsonApiStruct
{
	string status;
	string message;

	void MG_ApplyProjectResponse()
	{
		RegV("status");
		RegV("message");
	}
}

class MG_ApplyProject : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new MG_ApplyProjectRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		MG_ApplyProjectRequest req = MG_ApplyProjectRequest.Cast(request);
		string file = req.file;
		if (file.IsEmpty())
			file = "$profile:MapGen/mapgen.json";

		MG_ApplyProjectResponse resp = new MG_ApplyProjectResponse();
		resp.message = MG_ProjectApplier.Apply(file);
		resp.status = "ok";
		if (resp.message.StartsWith("error:"))
			resp.status = "error";

		Print("[MapGen] (bridge) " + resp.message, LogLevel.NORMAL);
		return resp;
	}
}
#endif
