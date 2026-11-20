#ifdef WORKBENCH
//! NET API entry point "MG_SetComments": shows the web app comments in the World Editor as CommentEntity
//! (3D text, editor only). File written by the bridge (POST /comments, and after every /apply):
//! one comment per line "x z resolved n text" (resolved 0/1, text = rest of the line, no newline).
//! Every call replaces the previous markers (entities named MG_COM_*).
class MG_SetCommentsRequest : JsonApiStruct
{
	string file;

	void MG_SetCommentsRequest()
	{
		RegV("file");
	}
}

class MG_SetCommentsResponse : JsonApiStruct
{
	string status;
	string message;

	void MG_SetCommentsResponse()
	{
		RegV("status");
		RegV("message");
	}
}

class MG_SetComments : NetApiHandler
{
	static const string NAME_PREFIX = "MG_COM_";

	override JsonApiStruct GetRequest()
	{
		return new MG_SetCommentsRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		MG_SetCommentsRequest req = MG_SetCommentsRequest.Cast(request);
		MG_SetCommentsResponse resp = new MG_SetCommentsResponse();
		resp.status = "error";
		string file = req.file;
		if (!file)
			file = "$profile:MapGen/comments.txt";

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
		FileHandle fh = FileIO.OpenFile(file, FileMode.READ);
		if (!fh)
		{
			resp.message = "cannot read " + file;
			return resp;
		}

		bool ownsAction = api.BeginEntityAction("MapGen comments");
		for (int i = api.GetEditorEntityCount() - 1; i >= 0; i--)
		{
			IEntitySource old = api.GetEditorEntity(i);
			if (old && old.GetName().StartsWith(NAME_PREFIX))
				api.DeleteEntity(old);
		}

		int layer = api.GetCurrentEntityLayerId();
		int made;
		string line;
		array<string> parts = {};
		while (fh.ReadLine(line) >= 0)
		{
			parts.Clear();
			line.Split(" ", parts, false);
			if (parts.Count() < 5)
				continue;
			float x = parts[0].ToFloat();
			float z = parts[1].ToFloat();
			bool resolved = parts[2] == "1";
			string n = parts[3];
			int skip = parts[0].Length() + parts[1].Length() + parts[2].Length() + parts[3].Length() + 4;
			string text = "#" + n + " " + line.Substring(skip, line.Length() - skip);
			vector pos = Vector(x, api.GetTerrainSurfaceY(x, z) + 4, z);
			IEntitySource src = api.CreateEntity("CommentEntity", NAME_PREFIX + made.ToString(), layer, null, pos, vector.Zero);
			if (!src)
				continue;
			api.SetVariableValue(src, null, "m_Comment", text);
			api.SetVariableValue(src, null, "m_Size", "1.5");
			api.SetVariableValue(src, null, "m_FaceCamera", "1");
			api.SetVariableValue(src, null, "m_ScaleByDistance", "1");
			api.SetVariableValue(src, null, "m_VisibleIngame", "0");
			api.SetVariableValue(src, null, "m_TextBackground", "1");
			if (resolved)
				api.SetVariableValue(src, null, "m_Color", "0.55 0.55 0.55");
			else
				api.SetVariableValue(src, null, "m_Color", "1 0.65 0.15");
			made++;
		}
		fh.Close();
		if (ownsAction)
			api.EndEntityAction();

		resp.status = "ok";
		resp.message = string.Format("%1 comment(s) placed", made);
		Print("[MapGen] (bridge) comments: " + resp.message, LogLevel.NORMAL);
		return resp;
	}
}
#endif
