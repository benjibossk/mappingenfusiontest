#ifdef WORKBENCH
//! Builds generator shapes the way they are made by hand in the World Editor (validated
//! 2026-10-15): a bare PolylineShapeEntity, origin at terrain height, points relative and
//! following the terrain, generator prefab as its child. Generation then fires by itself.
class MG_ShapeBuilder
{
	//! points: world X/Z pairs, the first one is the shape origin.
	//! generator: resource name "{GUID}path" or a bare path (resolved here). Empty = no generator.
	//! spline: SplineShapeEntity (road generators refuse polylines), else PolylineShapeEntity.
	static IEntitySource Create(WorldEditorAPI api, string name, array<float> pointsXZ, bool closed, string generator, bool spline = false, array<string> paramKeys = null, array<string> paramValues = null, int layer = -1, array<float> lift = null)
	{
		int count = pointsXZ.Count() / 2;
		if (count < 2)
		{
			Print("[MapGen] " + name + ": needs at least 2 points", LogLevel.ERROR);
			return null;
		}

		vector pos = Vector(pointsXZ[0], 0, pointsXZ[1]);
		bool lifted = lift && lift.Count() == count;
		pos[1] = api.GetTerrainSurfaceY(pos[0], pos[2]);
		if (lifted)
			pos[1] = pos[1] + lift[0];

		if (layer < 0)
			layer = api.GetCurrentEntityLayerId();
		string shapeClass = "PolylineShapeEntity";
		if (spline)
			shapeClass = "SplineShapeEntity";
		IEntitySource shapeSrc = api.CreateEntity(shapeClass, name, layer, null, pos, vector.Zero);
		if (!shapeSrc)
		{
			Print("[MapGen] cannot create shape " + name, LogLevel.ERROR);
			return null;
		}

		if (closed)
			api.SetVariableValue(shapeSrc, null, "IsClosed", "1");

		for (int p; p < count; p++)
		{
			float x = pointsXZ[p * 2];
			float z = pointsXZ[p * 2 + 1];
			float y = api.GetTerrainSurfaceY(x, z) - pos[1];
			if (lifted)
				y = y + lift[p];

			api.CreateObjectArrayVariableMember(shapeSrc, null, "Points", "ShapePoint", p);
			array<ref ContainerIdPathEntry> path = { new ContainerIdPathEntry("Points", p) };
			api.SetVariableValue(shapeSrc, path, "Position", string.Format("%1 %2 %3", x - pos[0], y, z - pos[2]));
		}

		if (generator.IsEmpty())
			return shapeSrc;

		// a bare path is not resolved by the engine: the generator would come out empty
		if (!generator.StartsWith("{"))
			generator = Workbench.GetResourceName(generator);

		IEntitySource genSrc = api.CreateEntity(generator, "", layer, shapeSrc, vector.Zero, vector.Zero);
		if (!genSrc)
		{
			Print("[MapGen] " + name + ": cannot create generator " + generator, LogLevel.ERROR);
			return shapeSrc;
		}

		if (paramKeys && paramValues)
		{
			for (int k; k < paramKeys.Count() && k < paramValues.Count(); k++)
			{
				if (!api.SetVariableValue(genSrc, null, paramKeys[k], paramValues[k]))
					Print("[MapGen] " + name + ": cannot set " + paramKeys[k], LogLevel.WARNING);
			}
		}

		return shapeSrc;
	}
}
#endif
