# Community parcels

Ready-made lots (house + garden, flats + parking, farm yard...) shipped with the site and offered to every
mapper in the Parcel library (Villages tab, 📦).

To add yours:
1. Make the parcel in the site (📦 Parcel library), then **Export JSON**.
2. Put the file here (`my-parcels.json`, one parcel or an array) and add its name to `index.json`.
3. Open a pull request. Use vanilla prefabs, or say which mod the prefabs come from.

Format: metres, the street on the +Z side, `items[0]` is the main building.
`cat`: houseS, houseM, houseL, farm, civic or block (flats + parking).
