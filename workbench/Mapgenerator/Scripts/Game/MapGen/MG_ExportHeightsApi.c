#ifdef WORKBENCH
//! NET API entry point "MG_ExportHeights": samples the open world's terrain on a grid and
//! writes it to $profile:MapGen/heights.txt, for the web map (relief + sea).
//! File: header line "minX minZ step cols rows ocean", then one line of heights per row
//! (row 0 = minZ, west to east), 2 decimals.
class MG_ExportHeightsRequest : JsonApiStruct
{
	float step;

	void MG_ExportHeightsRequest()
	{
		RegV("step");
	}
}

class MG_ExportHeightsResponse : JsonApiStruct
{
	string status;
	string message;
	string file;

	void MG_ExportHeightsResponse()
	{
		RegV("status");
		RegV("message");
		RegV("file");
	}
}

class MG_ExportHeights : NetApiHandler
{
	static const string FILE = "$profile:MapGen/heights.txt";

	override JsonApiStruct GetRequest()
	{
		return new MG_ExportHeightsRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		MG_ExportHeightsRequest req = MG_ExportHeightsRequest.Cast(request);
		MG_ExportHeightsResponse resp = new MG_ExportHeightsResponse();
		resp.status = "error";

		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			resp.message = "WorldEditor module not loaded";
			return resp;
		}

		WorldEditorAPI api = worldEditor.GetApi();
		vector mins, maxs;
		if (!api || !worldEditor.GetTerrainBounds(mins, maxs))
		{
			resp.message = "no world / terrain open in edit mode";
			return resp;
		}

		float step = req.step;
		if (step < 2)
			step = 8;

		int cols = Math.Floor((maxs[0] - mins[0]) / step) + 1;
		int rows = Math.Floor((maxs[2] - mins[2]) / step) + 1;

		float ocean;
		BaseWorld world = api.GetWorld();
		if (world)
			ocean = world.GetOceanBaseHeight();

		FileIO.MakeDirectory("$profile:MapGen");
		FileHandle fh = FileIO.OpenFile(FILE, FileMode.WRITE);
		if (!fh)
		{
			resp.message = "cannot write " + FILE;
			return resp;
		}

		fh.WriteLine(string.Format("%1 %2 %3 %4 %5 %6", mins[0], mins[2], step, cols, rows, ocean));
		for (int r; r < rows; r++)
		{
			float z = mins[2] + r * step;
			string line;
			for (int c; c < cols; c++)
			{
				if (c > 0)
					line += " ";
				line += api.GetTerrainSurfaceY(mins[0] + c * step, z).ToString(-1, 2);
			}
			fh.WriteLine(line);
		}
		fh.Close();

		resp.status = "ok";
		resp.file = FILE;
		resp.message = string.Format("%1 x %2 heights, step %3 m, ocean %4", cols, rows, step, ocean);
		Print("[MapGen] (bridge) heights: " + resp.message, LogLevel.NORMAL);
		return resp;
	}
}
#endif
