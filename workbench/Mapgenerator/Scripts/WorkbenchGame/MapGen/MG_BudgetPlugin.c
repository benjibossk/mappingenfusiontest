#ifdef WORKBENCH
//! Entity budget: counts every live entity of the world (generator trees, children of buildings
//! included) on a grid, compares each cell with the limit of the chosen platform, then
//! - writes $profile:MapGen/budget.txt (totals, heaviest cells, most frequent prefabs),
//! - flags suspect spots: duplicates (same prefab at the same place), entities buried under the terrain,
//! - terrain occlusion: the relief is the main occluder (BIKI terrain tutorial). Heavy cells on flat
//!   ground (everything drawn at once) and heavy cells on crests (seen from far) are listed.
//! - floats the count over every cell above the limit.
//! The limits are PROVISIONAL (no measured console figures yet): to be calibrated with an FPS bench.
enum MG_EPlatform
{
	XBOX_SERIES_S,
	XBOX_SERIES_X,
	PS5,
	PC
}

[WorkbenchPluginAttribute(name: "MapGen - Entity budget", category: "MapGen", wbModules: { "WorldEditor" }, awesomeFontCode: 0xF080)]
class MG_BudgetPlugin : WorldEditorPlugin
{
	[Attribute("0", UIWidgets.ComboBox, "Target platform", "", ParamEnumArray.FromEnum(MG_EPlatform))]
	protected MG_EPlatform m_ePlatform;

	[Attribute("200", UIWidgets.Slider, "Cell size (m)", "50 1000 50")]
	protected float m_fCell;

	[Attribute("1500", desc: "Entities per cell, Xbox Series S (provisional)")]
	protected int m_iLimitXboxS;

	[Attribute("2500", desc: "Entities per cell, Xbox Series X (provisional)")]
	protected int m_iLimitXboxX;

	[Attribute("2500", desc: "Entities per cell, PS5 (provisional)")]
	protected int m_iLimitPS5;

	[Attribute("4000", desc: "Entities per cell, PC (provisional)")]
	protected int m_iLimitPC;

	[Attribute("15", desc: "Relief (m, highest - lowest point) under which a cell counts as flat: no terrain occlusion")]
	protected float m_fFlat;

	[Attribute("1", desc: "Float the count over the cells above the limit")]
	protected bool m_bShowLabels;

	protected ref array<int> m_aCounts = {};
	protected ref map<string, int> m_mTypes = new map<string, int>();
	protected int m_iCols;
	protected int m_iRows;
	protected vector m_vMin;
	protected ref map<string, int> m_mSeen = new map<string, int>();
	protected ref array<string> m_aSuspects = {};
	protected WorldEditorAPI m_Api;
	protected static ref array<ref DebugTextWorldSpace> s_aTexts = {};

	//------------------------------------------------------------------------------------------------
	protected bool OnEntity(IEntity e)
	{
		vector o = e.GetOrigin();
		int c = Math.Floor((o[0] - m_vMin[0]) / m_fCell);
		int r = Math.Floor((o[2] - m_vMin[2]) / m_fCell);
		if (c < 0 || r < 0 || c >= m_iCols || r >= m_iRows)
			return true;
		m_aCounts[r * m_iCols + c] = m_aCounts[r * m_iCols + c] + 1;
		string type = e.ClassName();
		EntityPrefabData pd = e.GetPrefabData();
		if (pd)
		{
			string pn = pd.GetPrefabName();
			if (!pn.IsEmpty())
				type = FilePath.StripPath(pn);
		}
		m_mTypes.Set(type, m_mTypes.Get(type) + 1);
		// duplicate: same prefab within 10 cm
		string key = string.Format("%1|%2|%3|%4", type, Math.Round(o[0] * 10), Math.Round(o[1] * 10), Math.Round(o[2] * 10));
		if (m_mSeen.Contains(key))
			Suspect("duplicate", type, o);
		else
			m_mSeen.Insert(key, 1);
		float ground = m_Api.GetTerrainSurfaceY(o[0], o[2]);
		if (o[1] < ground - 3 && !e.GetParent())
			Suspect("buried", type, o);
		return true;
	}

	//------------------------------------------------------------------------------------------------
	protected void Suspect(string what, string type, vector o)
	{
		if (m_aSuspects.Count() < 500)
			m_aSuspects.Insert(string.Format("%1  %2  at %3 %4 %5", what, type, o[0], o[1], o[2]));
	}

	//------------------------------------------------------------------------------------------------
	protected int Limit()
	{
		if (m_ePlatform == MG_EPlatform.XBOX_SERIES_S)
			return m_iLimitXboxS;
		if (m_ePlatform == MG_EPlatform.XBOX_SERIES_X)
			return m_iLimitXboxX;
		if (m_ePlatform == MG_EPlatform.PS5)
			return m_iLimitPS5;
		return m_iLimitPC;
	}

	//------------------------------------------------------------------------------------------------
	override void Run()
	{
		WorldEditor we = Workbench.GetModule(WorldEditor);
		WorldEditorAPI api = we.GetApi();
		if (!api || !api.GetWorld())
			return;
		vector tmax;
		if (!we.GetTerrainBounds(m_vMin, tmax))
		{
			Print("[MapGen] budget: no terrain", LogLevel.WARNING);
			return;
		}
		if (m_fCell < 10)
			m_fCell = 10;
		m_iCols = Math.Ceil((tmax[0] - m_vMin[0]) / m_fCell);
		m_iRows = Math.Ceil((tmax[2] - m_vMin[2]) / m_fCell);
		m_aCounts.Clear();
		m_aCounts.Resize(m_iCols * m_iRows);
		for (int i = 0; i < m_aCounts.Count(); i++)
			m_aCounts[i] = 0;
		m_mTypes.Clear();
		m_mSeen.Clear();
		m_aSuspects.Clear();
		m_Api = api;
		vector qmin = m_vMin;
		vector qmax = tmax;
		qmin[1] = -10000;
		qmax[1] = 10000;
		api.GetWorld().QueryEntitiesByAABB(qmin, qmax, OnEntity);

		int limit = Limit();
		int total, over, worst;
		for (int i = 0; i < m_aCounts.Count(); i++)
		{
			total += m_aCounts[i];
			if (m_aCounts[i] > limit)
				over++;
			if (m_aCounts[i] > worst)
				worst = m_aCounts[i];
		}

		// report
		FileHandle f = FileIO.OpenFile("$profile:MapGen/budget.txt", FileMode.WRITE);
		if (f)
		{
			f.WriteLine(string.Format("platform %1  cell %2 m  limit %3 / cell (provisional)", typename.EnumToString(MG_EPlatform, m_ePlatform), m_fCell, limit));
			f.WriteLine(string.Format("total %1 entities, %2 cells over the limit, heaviest cell %3", total, over, worst));
			f.WriteLine("-- heaviest cells (x z = cell centre) --");
			array<int> order = {};
			for (int i = 0; i < m_aCounts.Count(); i++)
				order.Insert(i);
			for (int k = 0; k < Math.Min(10, order.Count()); k++)
			{
				int best = k;
				for (int j = k + 1; j < order.Count(); j++)
				{
					if (m_aCounts[order[j]] > m_aCounts[order[best]])
						best = j;
				}
				int tmp = order[k];
				order[k] = order[best];
				order[best] = tmp;
				int ci = order[k];
				f.WriteLine(string.Format("%1  at %2 %3", m_aCounts[ci], m_vMin[0] + (ci - (ci / m_iCols) * m_iCols + 0.5) * m_fCell, m_vMin[2] + (ci / m_iCols + 0.5) * m_fCell));
			}
			f.WriteLine(string.Format("-- terrain occlusion (cells above half the limit; flat = relief < %1 m) --", m_fFlat));
			array<float> mean = {};
			array<float> relief = {};
			for (int i = 0; i < m_aCounts.Count(); i++)
			{
				float x0 = m_vMin[0] + (i - (i / m_iCols) * m_iCols) * m_fCell;
				float z0 = m_vMin[2] + (i / m_iCols) * m_fCell;
				float lo = 100000, hi = -100000, sum = 0;
				for (int a = 0; a < 5; a++)
				{
					for (int b = 0; b < 5; b++)
					{
						float h = api.GetTerrainSurfaceY(x0 + a * m_fCell / 4, z0 + b * m_fCell / 4);
						lo = Math.Min(lo, h);
						hi = Math.Max(hi, h);
						sum += h;
					}
				}
				mean.Insert(sum / 25);
				relief.Insert(hi - lo);
			}
			int flatHeavy, crestHeavy;
			for (int i = 0; i < m_aCounts.Count(); i++)
			{
				if (m_aCounts[i] <= limit / 2)
					continue;
				int ic = i - (i / m_iCols) * m_iCols;
				int ir = i / m_iCols;
				float cx = m_vMin[0] + (ic + 0.5) * m_fCell;
				float cz = m_vMin[2] + (ir + 0.5) * m_fCell;
				if (relief[i] < m_fFlat)
				{
					flatHeavy++;
					f.WriteLine(string.Format("FLAT  %1 entities, relief %2 m  at %3 %4", m_aCounts[i], relief[i], cx, cz));
				}
				bool crest = true;
				for (int dr = -1; dr <= 1; dr++)
				{
					for (int dc = -1; dc <= 1; dc++)
					{
						int nr = ir + dr;
						int nc = ic + dc;
						if ((dr != 0 || dc != 0) && nr >= 0 && nc >= 0 && nr < m_iRows && nc < m_iCols && mean[nr * m_iCols + nc] >= mean[i])
							crest = false;
					}
				}
				if (crest)
				{
					crestHeavy++;
					f.WriteLine(string.Format("CREST %1 entities, seen from all around  at %2 %3", m_aCounts[i], cx, cz));
				}
			}
			f.WriteLine(string.Format("%1 heavy flat cells, %2 heavy crest cells", flatHeavy, crestHeavy));
			f.WriteLine(string.Format("-- suspects (%1, capped at 500) --", m_aSuspects.Count()));
			foreach (string sl : m_aSuspects)
				f.WriteLine(sl);
			f.WriteLine("-- most frequent prefabs --");
			array<string> keys = {};
			foreach (string key, int n : m_mTypes)
				keys.Insert(key);
			for (int k = 0; k < Math.Min(15, keys.Count()); k++)
			{
				int best = k;
				for (int j = k + 1; j < keys.Count(); j++)
				{
					if (m_mTypes.Get(keys[j]) > m_mTypes.Get(keys[best]))
						best = j;
				}
				string t = keys[k];
				keys[k] = keys[best];
				keys[best] = t;
				f.WriteLine(string.Format("%1  %2", m_mTypes.Get(keys[k]), keys[k]));
			}
			f.Close();
		}

		// labels over the cells above the limit
		s_aTexts.Clear();
		if (m_bShowLabels)
		{
			for (int i = 0; i < m_aCounts.Count(); i++)
			{
				if (m_aCounts[i] <= limit)
					continue;
				float x = m_vMin[0] + (i - (i / m_iCols) * m_iCols + 0.5) * m_fCell;
				float z = m_vMin[2] + (i / m_iCols + 0.5) * m_fCell;
				float y = api.GetTerrainSurfaceY(x, z) + 30;
				s_aTexts.Insert(DebugTextWorldSpace.Create(api.GetWorld(), string.Format("%1 / %2", m_aCounts[i], limit), DebugTextFlags.CENTER | DebugTextFlags.FACE_CAMERA, x, y, z, 20, 0xFFFF4040, 0xC0000000));
			}
		}
		Print(string.Format("[MapGen] budget %1: %2 entities, %3 cells over %4 / %5 m cell %6 suspects -> $profile:MapGen/budget.txt", typename.EnumToString(MG_EPlatform, m_ePlatform), total, over, limit, m_fCell, m_aSuspects.Count()), LogLevel.NORMAL);
	}

	//------------------------------------------------------------------------------------------------
	override void Configure()
	{
		Workbench.ScriptDialog("MapGen entity budget", "Platform, cell size and the PROVISIONAL limits per cell. Run counts the world.", this);
	}
}
#endif
