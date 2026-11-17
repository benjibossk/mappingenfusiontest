#ifdef WORKBENCH
//! NET API entry point "MG_ApplyOutside": places the off-map terrain ring written by the web app
//! (src/modules/outside.ts, bridge POST /outside) as Outside Terrain Core chunks.
//! REQUIRES the Outside Terrain Core mod (61F0D506562D9BC9) as a dependency of the open project:
//! the entity class OTC_OutsideTerrainChunkEntity comes from it.
//! File: header "OTC 1 count", then per chunk a line "x z size res" (chunk centre, metres) and a line of
//! res*res absolute heights, row = local +Z (south to north), west to east. Entities go at y = 0.
//! NOT COMPILED YET (repo copy, docs/OUTSIDE_TERRAIN.md): the array attribute format is to confirm.
class MG_ApplyOutsideRequest : JsonApiStruct
{
	string file;

	void MG_ApplyOutsideRequest()
	{
		RegV("file");
	}
}

class MG_ApplyOutsideResponse : JsonApiStruct
{
	string status;
	string message;

	void MG_ApplyOutsideResponse()
	{
		RegV("status");
		RegV("message");
	}
}

class MG_ApplyOutside : NetApiHandler
{
	static const string ENTITY_CLASS = "OTC_OutsideTerrainChunkEntity";
	static const string NAME_PREFIX = "MG_OTC_";

	override JsonApiStruct GetRequest()
	{
		return new MG_ApplyOutsideRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		MG_ApplyOutsideRequest req = MG_ApplyOutsideRequest.Cast(request);
		MG_ApplyOutsideResponse resp = new MG_ApplyOutsideResponse();
		resp.status = "error";
		string file = req.file;
		if (!file)
			file = "$profile:MapGen/outside.txt";

		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			resp.message = "WorldEditor module not loaded";
			return resp;
		}
		WorldEditorAPI api = worldEditor.GetApi();
		if (!api)
		{
			resp.message = "no world open";
			return resp;
		}

		FileHandle fh = FileIO.OpenFile(file, FileMode.READ);
		if (!fh)
		{
			resp.message = "cannot read " + file;
			return resp;
		}
		string line;
		fh.ReadLine(line);
		array<string> parts = {};
		line.Split(" ", parts, true);
		if (parts.Count() < 3 || parts[0] != "OTC")
		{
			fh.Close();
			resp.message = "bad header: " + line;
			return resp;
		}
		int count = parts[2].ToInt();

		bool ownsAction = api.BeginEntityAction("MapGen outside terrain");
		// replace the chunks of a previous send
		for (int i = api.GetEditorEntityCount() - 1; i >= 0; i--)
		{
			IEntitySource old = api.GetEditorEntity(i);
			if (old && old.GetName().StartsWith(NAME_PREFIX))
				api.DeleteEntity(old);
		}

		int layer = api.GetCurrentEntityLayerId();
		int made;
		for (int k = 0; k < count; k++)
		{
			string head, hs;
			if (fh.ReadLine(head) < 0 || fh.ReadLine(hs) < 0)
				break;
			parts.Clear();
			head.Split(" ", parts, true);
			if (parts.Count() < 4)
				continue;
			vector pos = Vector(parts[0].ToFloat(), 0, parts[1].ToFloat());
			string size = parts[2];
			string res = parts[3];
			IEntitySource src = api.CreateEntity(ENTITY_CLASS, NAME_PREFIX + k.ToString(), layer, null, pos, vector.Zero);
			if (!src)
				continue;
			api.SetVariableValue(src, null, "m_fWidth", size);
			api.SetVariableValue(src, null, "m_fHeight", size);
			api.SetVariableValue(src, null, "m_iResolution", res);
			hs.Replace(" ", ",");
			api.SetVariableValue(src, null, "m_aHeights", hs);
			made++;
		}
		fh.Close();
		if (ownsAction)
			api.EndEntityAction();

		resp.status = "ok";
		resp.message = string.Format("%1 / %2 outside chunks placed", made, count);
		if (made == 0 && count > 0)
		{
			resp.status = "error";
			resp.message = "no chunk created: is Outside Terrain Core (61F0D506562D9BC9) a dependency of this project?";
		}
		Print("[MapGen] (bridge) outside: " + resp.message, LogLevel.NORMAL);
		return resp;
	}
}
#endif
