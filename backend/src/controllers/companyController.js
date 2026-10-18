import prisma from "../config/prisma.js";

const STATUSES = ["Active", "Inactive"];
const PINCODE_REGEX = /^\d{6}$/;

const COMPANY_SELECT = {
  id: true,
  name: true,
  code: true,
  locality: true,
  city: true,
  state: true,
  pincode: true,
  status: true,
  createdAt: true,
  // `users` = users whose primary company this is (old single-company field),
  // `members` = users linked through UserCompany (a user can have many companies).
  _count: {
    select: { warehouses: true, users: true, members: true },
  },
};

// The UI reads `_count.users`; make it the number of users that belong to
// the company under either the old or the new relation.
function shapeCompany(company) {
  if (!company?._count) return company;

  const { members, users, ...counts } = company._count;

  return {
    ...company,
    _count: { ...counts, users: Math.max(users || 0, members || 0) },
  };
}

async function generateCompanyCode() {
  const lastCompany = await prisma.company.findFirst({
    where: { code: { startsWith: "COMP-" } },
    orderBy: { code: "desc" },
    select: { code: true },
  });

  let nextSeq = 1;
  if (lastCompany) {
    const match = lastCompany.code.match(/COMP-(\d+)/);
    if (match) nextSeq = parseInt(match[1], 10) + 1;
  }

  return `COMP-${String(nextSeq).padStart(4, "0")}`;
}

// POST /api/companies
// SUPER_ADMIN only.
// Creates a company record only. A company has no login account.
export async function createCompany(req, res) {
  try {
    const { name, locality, city, state, pincode } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Company name is required" });
    }
    if (!city || !city.trim()) {
      return res.status(400).json({ message: "City is required" });
    }
    if (!state || !state.trim()) {
      return res.status(400).json({ message: "State is required" });
    }
    if (!pincode || !PINCODE_REGEX.test(pincode.trim())) {
      return res.status(400).json({ message: "Enter a valid 6-digit pincode" });
    }

    let company;
    let attempt = 0;

    while (!company && attempt < 2) {
      const code = await generateCompanyCode();

      try {
        company = await prisma.company.create({
          data: {
            name: name.trim(),
            code,
            locality: locality && locality.trim() ? locality.trim() : null,
            city: city.trim(),
            state: state.trim(),
            pincode: pincode.trim(),
          },
          select: COMPANY_SELECT,
        });
        company = shapeCompany(company);
      } catch (err) {
        if (err.code === "P2002" && attempt === 0) {
          attempt += 1;
          continue;
        }
        throw err;
      }
    }

    return res.status(201).json({
      message: "Company created successfully",
      company,
    });
  } catch (error) {
    console.error("Create company error:", error);
    return res.status(500).json({
      message: "Something went wrong while creating the company",
    });
  }
}

export async function listCompanies(req, res) {
  try {
    const { search, status } = req.query;
    const where = {};

    if (status !== undefined) {
      if (!STATUSES.includes(status)) {
        return res.status(400).json({ message: "Invalid status filter" });
      }
      where.status = status;
    }

    if (search !== undefined && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { state: { contains: q, mode: "insensitive" } },
        { pincode: { contains: q, mode: "insensitive" } },
      ];
    }

    const companies = await prisma.company.findMany({
      where,
      select: COMPANY_SELECT,
      orderBy: { createdAt: "desc" },
    });

    return res.json({ data: companies.map(shapeCompany) });
  } catch (error) {
    console.error("List companies error:", error);
    return res.status(500).json({
      message: "Something went wrong while fetching companies",
    });
  }
}

export async function getCompany(req, res) {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.params.id },
      select: {
        ...COMPANY_SELECT,
        warehouses: {
          select: {
            id: true,
            name: true,
            code: true,
            locality: true,
            city: true,
            state: true,
            Inward: true,
            Outward: true,
          },
        },
      },
    });

    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }

    return res.json({ company: shapeCompany(company) });
  } catch (error) {
    console.error("Get company error:", error);
    return res.status(500).json({
      message: "Something went wrong while fetching the company",
    });
  }
}

export async function updateCompany(req, res) {
  try {
    const { name, locality, city, state, pincode, status } = req.body;

    const existing = await prisma.company.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) {
      return res.status(404).json({ message: "Company not found" });
    }
    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ message: "Company name is required" });
    }
    if (city !== undefined && !city.trim()) {
      return res.status(400).json({ message: "City is required" });
    }
    if (state !== undefined && !state.trim()) {
      return res.status(400).json({ message: "State is required" });
    }
    if (pincode !== undefined && !PINCODE_REGEX.test(pincode.trim())) {
      return res.status(400).json({ message: "Enter a valid 6-digit pincode" });
    }
    if (status !== undefined && !STATUSES.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const data = {};
    if (name !== undefined) data.name = name.trim();
    if (locality !== undefined) data.locality = locality.trim() ? locality.trim() : null;
    if (city !== undefined) data.city = city.trim();
    if (state !== undefined) data.state = state.trim();
    if (pincode !== undefined) data.pincode = pincode.trim();
    if (status !== undefined) data.status = status;

    const isBeingDeactivated = status === "Inactive" && existing.status !== "Inactive";
    const isBeingActivated = status === "Active" && existing.status !== "Active";

    const updatedCompany = await prisma.$transaction(async (tx) => {
      const company = await tx.company.update({
        where: { id: req.params.id },
        data,
        select: COMPANY_SELECT,
      });

      if (isBeingDeactivated || isBeingActivated) {
        await tx.warehouse.updateMany({
          where: { companyId: req.params.id },
          data: isBeingDeactivated
            ? { Inward: "Inactive", Outward: "Inactive" }
            : { Inward: "Active", Outward: "Active" },
        });
      }

      return company;
    });

    return res.json({
      message: "Company updated successfully",
      company: shapeCompany(updatedCompany),
    });
  } catch (error) {
    console.error("Update company error:", error);
    return res.status(500).json({
      message: "Something went wrong while updating the company",
    });
  }
}

export async function deleteCompany(req, res) {
  try {
    const { force } = req.query;

    const company = await prisma.company.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        _count: { select: { warehouses: true, users: true, members: true } },
      },
    });

    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }

    const userCount = Math.max(company._count.users, company._count.members);
    const hasDependents = company._count.warehouses > 0 || userCount > 0;

    if (hasDependents && force !== "true") {
      return res.status(409).json({
        message:
          "This company still has warehouses or users linked to it. " +
          "Reassign or remove them first, or retry with ?force=true to unlink and delete anyway.",
        warehouseCount: company._count.warehouses,
        userCount,
      });
    }

    await prisma.company.delete({ where: { id: req.params.id } });
    return res.json({ message: "Company deleted successfully" });
  } catch (error) {
    console.error("Delete company error:", error);
    return res.status(500).json({
      message: "Something went wrong while deleting the company",
    });
  }
}
