#ifdef WORKBENCH
//! NET API entry point "MG_GetCamera": World Editor viewport camera, for the live marker on the web 2D map.
//! yaw in degrees, 0 = north (+Z), clockwise; pitch in degrees, positive = looking up.
class MG_GetCameraResponse : JsonApiStruct
{
	bool ok;
	float x;
	float y;
	float z;
	float yaw;
	float pitch;

	void MG_GetCameraResponse()
	{
		RegV("ok");
		RegV("x");
		RegV("y");
		RegV("z");
		RegV("yaw");
		RegV("pitch");
	}
}

class MG_GetCamera : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new JsonApiStruct();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		MG_GetCameraResponse resp = new MG_GetCameraResponse();
		resp.ok = false;
		WorldEditor we = Workbench.GetModule(WorldEditor);
		if (!we)
			return resp;
		WorldEditorAPI api = we.GetApi();
		if (!api)
			return resp;
		BaseWorld world = api.GetWorld();
		if (!world)
			return resp;
		vector camMat[4];
		world.GetCurrentCamera(camMat);
		vector pos = camMat[3];
		vector fwd = camMat[2];
		resp.x = pos[0];
		resp.y = pos[1];
		resp.z = pos[2];
		float yaw = Math.Atan2(fwd[0], fwd[2]) * Math.RAD2DEG;
		if (yaw < 0)
			yaw = yaw + 360;
		resp.yaw = yaw;
		float horiz = Math.Sqrt(fwd[0] * fwd[0] + fwd[2] * fwd[2]);
		resp.pitch = Math.Atan2(fwd[1], horiz) * Math.RAD2DEG;
		resp.ok = true;
		return resp;
	}
}
#endif

#ifdef WORKBENCH
//! NET API entry point "MG_SetCamera" {x,y,z,yaw,pitch}: moves the World Editor camera (automatic 2D/3D comparison).
//! Same convention as MG_GetCamera. Prints the pose to the console so every screenshot can be traced.
class MG_SetCameraRequest : JsonApiStruct
{
	float x;
	float y;
	float z;
	float yaw;
	float pitch;

	void MG_SetCameraRequest()
	{
		RegV("x");
		RegV("y");
		RegV("z");
		RegV("yaw");
		RegV("pitch");
	}
}

class MG_SetCamera : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new MG_SetCameraRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		MG_SetCameraRequest req = MG_SetCameraRequest.Cast(request);
		MG_GetCameraResponse resp = new MG_GetCameraResponse();
		resp.ok = false;
		WorldEditor we = Workbench.GetModule(WorldEditor);
		if (!we)
			return resp;
		WorldEditorAPI api = we.GetApi();
		if (!api)
			return resp;
		float yr = req.yaw * Math.DEG2RAD;
		float pr = req.pitch * Math.DEG2RAD;
		vector dir = Vector(Math.Sin(yr) * Math.Cos(pr), Math.Sin(pr), Math.Cos(yr) * Math.Cos(pr));
		vector pos = Vector(req.x, req.y, req.z);
		api.SetCamera(pos, dir);
		Print(string.Format("[MapGen] camera set X %1 Y %2 Z %3 cap %4 deg pitch %5", req.x, req.y, req.z, req.yaw, req.pitch), LogLevel.NORMAL);
		resp.x = req.x;
		resp.y = req.y;
		resp.z = req.z;
		resp.yaw = req.yaw;
		resp.pitch = req.pitch;
		resp.ok = true;
		return resp;
	}
}
#endif
