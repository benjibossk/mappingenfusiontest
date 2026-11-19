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
