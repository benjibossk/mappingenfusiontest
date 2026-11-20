#ifdef WORKBENCH
//! Builds generator shapes the way they are made by hand in the World Editor (validated
//! 2026-10-15): a bare PolylineShapeEntity, origin at terrain height, points relative and
//! following the terrain, generator prefab as its child. Generation then fires by itself.
class MG_ShapeBuilder
{
	//! points: world X/Z pairs, the first one is the shape origin.
	//! generator: resource name "{GUID}path" or a bare path (resolved here). Empty = no generator.
	//! spline: SplineShapeEntity (road generators refuse polylines), else PolylineShapeEntity.
	static IEntitySource Create(WorldEditorAPI api, string name, array<float> pointsXZ, bool closed, string generator, bool spline = false, array<string> paramKeys = null, array<string> paramValues = null, int layer = -1, array<float> lift = null, bool powerSource = false, array<int> junctions = null, bool perPoint = false)
	{
		// drop points closer than 0.5 m to the previous kept one (and a closing point on top of the first):
		// zero-length segments make ForestGeneratorEntity divide by zero (BadFloat assertion, 1.9)
		array<float> cleanXZ = {};
		array<float> cleanLift = {};
		bool hasLift = lift && lift.Count() == pointsXZ.Count() / 2;
		for (int q; q < pointsXZ.Count() / 2; q++)
		{
			float qx = pointsXZ[q * 2];
			float qz = pointsXZ[q * 2 + 1];
			int n = cleanXZ.Count();
			if (n >= 2 && Math.AbsFloat(qx - cleanXZ[n - 2]) + Math.AbsFloat(qz - cleanXZ[n - 1]) < 0.5)
				continue;
			cleanXZ.Insert(qx);
			cleanXZ.Insert(qz);
			if (hasLift)
				cleanLift.Insert(lift[q]);
		}
		int cn = cleanXZ.Count();
		if (closed && cn >= 6 && Math.AbsFloat(cleanXZ[0] - cleanXZ[cn - 2]) + Math.AbsFloat(cleanXZ[1] - cleanXZ[cn - 1]) < 0.5)
		{
			cleanXZ.Remove(cn - 1);
			cleanXZ.Remove(cn - 2);
			if (hasLift)
				cleanLift.Remove(cleanLift.Count() - 1);
		}
		pointsXZ = cleanXZ;
		if (hasLift)
			lift = cleanLift;

		int count = pointsXZ.Count() / 2;
		if (count < 2 || (closed && count < 3))
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

		// power line fed from its first point: Points[0].Data[0] = SCR_PowerlineGeneratorPointData,
		// its m_JunctionData.m_bPowerSource = true (vanilla SCR_PowerlineGeneratorJunctionData)
		if (powerSource)
		{
			array<ref ContainerIdPathEntry> p0 = { new ContainerIdPathEntry("Points", 0) };
			bool ok = api.CreateObjectArrayVariableMember(shapeSrc, p0, "Data", "SCR_PowerlineGeneratorPointData", 0);
			array<ref ContainerIdPathEntry> d0 = { new ContainerIdPathEntry("Points", 0), new ContainerIdPathEntry("Data", 0) };
			ok = ok && api.CreateObjectVariableMember(shapeSrc, d0, "m_JunctionData", "SCR_PowerlineGeneratorJunctionData");
			array<ref ContainerIdPathEntry> j0 = { new ContainerIdPathEntry("Points", 0), new ContainerIdPathEntry("Data", 0), new ContainerIdPathEntry("m_JunctionData") };
			ok = ok && api.SetVariableValue(shapeSrc, j0, "m_bPowerSource", "1");
			if (!ok)
				Print("[MapGen] " + name + ": cannot mark point 0 as power source", LogLevel.WARNING);
		}

		// branch points: same Data / m_JunctionData, left at its defaults (the generator puts its junction pole there)
		if (junctions)
		{
			int npts = pointsXZ.Count() / 2;
			foreach (int ji : junctions)
			{
				if (ji < 0 || ji >= npts || (ji == 0 && powerSource))
					continue;
				array<ref ContainerIdPathEntry> pj = { new ContainerIdPathEntry("Points", ji) };
				bool jok = api.CreateObjectArrayVariableMember(shapeSrc, pj, "Data", "SCR_PowerlineGeneratorPointData", 0);
				array<ref ContainerIdPathEntry> dj = { new ContainerIdPathEntry("Points", ji), new ContainerIdPathEntry("Data", 0) };
				jok = jok && api.CreateObjectVariableMember(shapeSrc, dj, "m_JunctionData", "SCR_PowerlineGeneratorJunctionData");
				if (!jok)
					Print("[MapGen] " + name + ": cannot mark point " + ji + " as junction", LogLevel.WARNING);
			}
		}

		// one pole per point (m_bGeneratePerPoint on every point, SCR_PowerlineGeneratorEntity skips its own
		// m_fDistance walk between two per-point anchors): the web tool knows every pole foot and keeps it off the roads
		if (perPoint)
		{
			int npp = pointsXZ.Count() / 2;
			for (int pp; pp < npp; pp++)
			{
				bool hasData = (pp == 0 && powerSource);
				if (junctions && junctions.Contains(pp))
					hasData = true;
				array<ref ContainerIdPathEntry> ppath = { new ContainerIdPathEntry("Points", pp) };
				bool pok = true;
				if (!hasData)
					pok = api.CreateObjectArrayVariableMember(shapeSrc, ppath, "Data", "SCR_PowerlineGeneratorPointData", 0);
				array<ref ContainerIdPathEntry> pdata = { new ContainerIdPathEntry("Points", pp), new ContainerIdPathEntry("Data", 0) };
				pok = pok && api.SetVariableValue(shapeSrc, pdata, "m_bGeneratePerPoint", "1");
				if (!pok)
					Print("[MapGen] " + name + ": cannot set point " + pp + " per point", LogLevel.WARNING);
			}
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
