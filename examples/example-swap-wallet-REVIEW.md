# Transactions you must review before filing

This file lists every transaction the converter could **not** classify with confidence, plus every row it did emit that still needs your eyes on it.

**Read this before you import anything.** The CSV is a starting point, not a finished tax return. Nothing here is an error in your wallet. It is the tool telling you where it refused to guess.

- Account: `keeta_aabva3ph7du7vxsjlixr3pgzxyvseizddgxzj7uwzixvvlv2tuewaquqkerc24i`
- Network: main (network id 0x5382)
- Generated: 2026-07-19T21:34:43.250Z
- Staples fetched: 2008
- Rows written to CSV: 1997
- Excluded from CSV: 11
- Skipped as non-financial: 0

## ⚠️ READ THIS BEFORE YOU IMPORT: pick the right KTA

When you upload this file, CoinLedger will show a **"Shared Ticker Symbols Detected"** prompt. More than one asset uses the ticker `KTA`.

**Choose `KTA - Keeta`.**

The other option (`KTA - KTA`) is an unrelated asset. If you pick it, CoinLedger will happily price your entire report against the wrong coin. No error, no warning, just wrong numbers all the way through. This is the single easiest way to get a wrong return out of a correct CSV.

CoinLedger can remember this mapping, so it is a one-time choice per account.

## A note on very precise amounts

**1213 rows carry more decimal places than a spreadsheet reliably preserves** (up to 29 significant digits). Keeta tokens commonly use 18 decimal places, so this is normal rather than a problem with your wallet.

**The exact values are in your CSV, unrounded.** The warning is about what happens next: if you open the file in Excel, Google Sheets or Numbers and save it, those amounts can be silently rounded before your tax software ever sees them.

**Upload the CSV as it is. Do not open and re-save it first.**

## ⚠️ 1990 rows use tokens CoinLedger cannot price

Tokens affected: **MURF, CHTA, LUCKY, MKTA, LP_KTA_MURF**

CoinLedger only has price history for assets it already knows about. For anything else you have to add it as a **custom asset**, and then **enter the price yourself for every transaction, at every date**. There is no automatic pricing and no bulk lookup that fills it in for you.

**1990 rows means 1990 prices to research and type in.** Decide whether that is worth it before you import. If it is not, you may prefer to import only the assets CoinLedger prices and handle these separately.

## How to import

1. In CoinLedger, go to **Import → Other Account** and upload the CSV.
2. When prompted about shared tickers, select **`KTA - Keeta`** (see above).
3. Review everything listed further down this file before filing.

## About protocol fees

**Fee columns in the CSV are deliberately left blank.** Keeta reports a per-staple aggregate called `feeUnits`, but the unit it is denominated in is not documented and could not be verified. Interpreting it as KTA base units produces implausibly small values (a typical fee would be about 0.000000000000002 KTA), which strongly suggests it is a different unit entirely.

Across this export the raw `feeUnits` total was **8272860** across 2008 staples. Rather than write a number we cannot justify into a tax document, the tool omits it and tells you here.

If your protocol fees are material to your filing, ask a professional how to treat them.

## more than two tokens moved, so this is not a simple trade  (1)

These moved **more than two tokens at once**, so they are not a simple swap of one thing for another.

The real example seen on-chain is a token launch: a new token is created and its supply issued in the same transaction, so several tokens arrive and none leave. That is not a trade, and forcing it into a trade row would misreport it. They are excluded and listed below.

| Staple hash | Date (UTC) | Detail |
|---|---|---|
| `429A3440D55048B5749008A90A0D1C0F1A10D292DAD2F41707CB910156DC1C14` | 12/03/2025 05:38:19 | 3 token(s) in, 0 out: +1000000000000000000 raw KTA / +1000000000000000000000000 raw MURF / +1000 raw LP_KTA_MURF |

## CoinLedger has no price data for this token  (1990)

**These rows ARE in your CSV**, but your tax software probably has no price history for the token.

CoinLedger only carries prices for assets it knows. For anything else you have to add it as a **custom asset** and then supply the price yourself, per transaction, at each date. There is no automatic pricing and no shortcut.

Check the count above before you import, so you know how much manual work you are taking on. If it is large, it may be easier to import only the assets your software already prices and handle the rest separately.

| Staple hash | Date (UTC) | Detail |
|---|---|---|
| `74F743C37C7C0E4FB2C1C99FC0B95938A47A53DB6E0E8E51B84D02D931288360` | 07/19/2026 16:54:33 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `55F49FEB2913080710D7E7F6F830EBCBFB83962EA9177445591B6A805F82DED4` | 07/17/2026 10:50:43 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `B95FBDEAB8E6D1ED10F9F1ADAD40B686F2257877ADB39A5075A69898D1DD7612` | 07/17/2026 03:16:30 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `E49771ED012CCFE39D30875EA96CAA0FF540B89C5FB2225F57D5CF7BD1E3BB56` | 07/17/2026 03:16:03 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `46D48770D6E3F993B8505EAA873E07CBF27BAD6D5DB1C805D6F43B2C51FB3F8B` | 07/16/2026 14:19:54 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `ADEA39DB0FED6BDCC70A9B7B206311AD6D09C3820A0994CE3477B9C6E13E2E4A` | 07/16/2026 13:59:06 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `D8BDBE2666CCD5DDA5461D72829118C91DD39ED8169531426D74D8578310AD01` | 07/14/2026 19:05:57 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `95C48F7BCDE6FCFE42F8556C992EA4B9D0E1990CFFAF73D33C9B3ACFB14DE7F4` | 07/14/2026 19:05:44 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `22AB9F39C392B0BAFDEED4E7473A5B71C04B6C6DD21E38283B3931F6F3843764` | 07/14/2026 13:22:56 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `CE643C5F804E6EB27464D4D5764BDE5ABA2042254C357177CDEF1F7B768E20BC` | 07/13/2026 21:27:28 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `47AE58D6FB8998472F407C04AB0362BA062F27B1DFD70DE4ABA3135D5541023A` | 07/13/2026 12:53:04 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `A68E1CEF06D2D183E78FA5D13ECC11A5CF36B077EDEC720B1674FB063903A2AA` | 07/12/2026 09:15:01 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `3C7BD644ED23BE345D28EF88D32CB3984C128AB13349EE732E2F9A1DB1B9C8F2` | 07/11/2026 19:17:49 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `FBD0EF75BF5907EF0F9DDE11B7E30D807B90B6DA16D2457DAFBEE28D3E47A6CB` | 07/11/2026 11:03:00 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `BF1F8CC926CC49691D8198B5D67ADCEB87669F1533A3840727BC31FD1CC9644E` | 07/10/2026 19:01:48 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `6090CADF3C003920DCDA5CDC54D710FC558DD4A114B9E136C880B90049AC703A` | 07/10/2026 18:59:49 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `DCFBFF49865F09CCE4FC6F3DB323476E55B3B07F97A4636CE885BE788A29FC99` | 07/10/2026 17:59:45 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `647C94933ED389EC4494B80EA48F9A769385062ADBA136C502210AD48DE6BC1F` | 07/10/2026 17:59:18 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `6A756C8E5B6D1DC8266143F908CCFB0850312253D941E76B5075BE2F41BB0237` | 07/10/2026 11:26:00 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `3B25B658C8FD6A65F433ED7FF1C7FA78BCD7BD27FFBF4532C1AF7C70DD67D483` | 07/10/2026 04:14:01 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `6D7DF534E8A1B2FA15EEB7520B292845F561A66367D45296965D3F4CBF403DA1` | 07/09/2026 21:18:45 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `A668EC2952AF1258C553D4D7B20091DF951EF9D17975C6820D12969C1E367F5E` | 07/09/2026 18:17:34 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `EB942049A65DA6B5C09F5228076E392C61D889CD77784F6F774C459172EEBBB7` | 07/09/2026 18:10:08 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `FAC379D34DFB38001274294738703D502048A924C6BAE6B5D1F6AE1B488AD5F5` | 07/09/2026 16:25:08 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `430CAC424C7E9E7124A9FFA1219522BA9327B180E2EE6DB494294AAE4D6B1A3D` | 07/09/2026 15:32:13 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `68F58876D78271C1C276D1595D5BCBD98AC39CA2EDB1304ED4FB3F9AE304922A` | 07/09/2026 15:32:02 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `941E603960CF9AAEAB7B0B162C58F5B2B5F45EFEF603D176BA5FA8F19475D9AE` | 07/09/2026 14:54:08 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `B5A4AD6FB8C2A084A57A0F333CB1267A5DD4BC848B5887086A8AE8BB03EF0046` | 07/08/2026 22:08:25 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `4162025C41BD88CEEBA1367E6DED2BCAB03C714B5A8E83D1CE1E91F3BB073668` | 07/08/2026 15:55:24 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `ADC9DCA6C121C546FF0FBB4379B0F6747825A75E1E977469685F9D48CD0921DD` | 07/08/2026 13:43:24 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `620A2C7AABB327EDC13EFB61501FCE6FF58A615AB14222C7079D06B6F7BAD285` | 07/08/2026 07:54:33 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `B7989E275CD37AED2B7BFE61E0F541B9756088C0CB437D83E438E08F41962DA0` | 07/08/2026 05:57:26 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `C6D796CFCF6164BA74E0A7B5537FEAD13FADCFA1A01122ED43C6DEBA185E498C` | 07/07/2026 21:35:35 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `508582699FE59E198A5E70780CEC0D23ACDB142060B8367A62BF3F8EA2F830E0` | 07/07/2026 21:28:18 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `0EBD252D100A13AF1448EF4587C8157D4FF89077605BDB60BA38490B96593931` | 07/07/2026 16:12:06 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `418B26E21A20998FDDA2D401827F8B221B8F5403A01F99D1F148DC0646F42574` | 07/07/2026 05:20:10 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `7A95C0625DA949D737A0C7E0786A42ACA8B1099E1BD5F3ECDAA351DDF33DAB2F` | 07/07/2026 02:24:25 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `20F99107662CF61375EDA6BD1D9B9755D7A838F4D50B8EE953F2BCC729E7BD59` | 07/06/2026 20:04:28 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `16FCEC18CCFA1ADC5D612ADB7C4E6494B7CBDD21D0604C08A2075724E1319819` | 07/06/2026 20:02:05 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `A6E090D9677171183FA3A5C907DDE3CF1710961641223C5C66A1768278145584` | 07/06/2026 20:00:27 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `C2C71C282965BBD3364FB6987E65160C6F3794B32AEBE6B23AA1B2C30FE489FF` | 07/06/2026 19:58:27 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `C2ADE2E3F93DC369DAB9DEBDA62E5DE76E696582B0E85D706DC4FD85597CD636` | 07/06/2026 14:32:49 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `027F33D4ECC78BAB59EF041E1DF5A6CBAEAE8EFDDDBBBFC00C8C9D632856B862` | 07/06/2026 14:32:25 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `77A775E2BC3C35D589E7EDACFE7672BE10852FC9B7BAA2E82C2722798B4B531F` | 07/06/2026 13:08:27 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `895A686D2BB0DD49213C415DAC56D04CF2B48DBB701A419216DB794B4DEF362F` | 07/06/2026 12:33:53 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `0A45AB7BCEDA1A24FD496441175B662D6DF95FF053C5B8FC5B54FEB0A4ADDA87` | 07/05/2026 22:29:48 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `97FA13FCD66A92CB3FFD4C8BE481D8CD57A269FD9FB26A6208C992211D6F90C5` | 07/05/2026 01:13:41 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `E64B2DAD0B05A5A2488A5B8B0475D2E9AC7DA4A4E3D38C4577D45953DF9D0161` | 07/04/2026 09:57:10 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `1FB6234AF66521297BB6A4956F1BB26C8BAD779EEBCB12979F017FC6BD8DFC84` | 07/04/2026 09:56:59 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `DB75E02A22C020696E77EC9B117B124536A7FB002ABD5AE60ECEBB52DCF74835` | 07/04/2026 09:56:43 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `AD26D252C4CAD4D07531C7A327063C3C157F62C6CC315C08459AC0734EF46115` | 07/04/2026 05:39:18 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `E1CC9884106B3B9D8B56D153283D8BA1978CFB7DE774ACD1B49B8EF69E3EE5CB` | 07/04/2026 05:03:03 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `B73473FD529AD6FCCA1E31160949D709876A54AB1341A2465C7B353EC9D13FC3` | 07/04/2026 03:58:36 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `0BB52AAF18145B22DA26869E4FEB244DC8F1258D867ABC956644759F6675FA8E` | 07/04/2026 01:03:27 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `C5996B7A9296728B540CA2625A78614B2558EAE9EAFC340E72DB97C05CF60EC9` | 07/04/2026 00:39:30 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `01F44C3FCD40555E37451A032CD45D861E5162B7A0C23902250EEAB00B7005C5` | 07/04/2026 00:39:20 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `2682D9FDD03098012EC77698EF2625358B8B7B91BEED3CDB26D6F6AE5E44EB78` | 07/04/2026 00:37:58 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `771A2E76CE82CDCA6FEFD7F1E70DECD7967205719D9C01C8635DDB2F215FE650` | 07/03/2026 23:17:31 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `7B016BC6F2F2173663A3F517D552B462623918CE35E31CED73E68569277301ED` | 07/03/2026 23:17:24 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `499DC55524D972B8E362C5654769C7671D4CC7AFCCA6F1ACCF13162537A040E3` | 07/03/2026 22:33:06 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `0AD11C037E354A946862CFC7C6F1F04AD54772A1C56BDA11F772E18979F1D5BC` | 07/03/2026 22:32:14 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `EC62F5C5D5BED8EA89067E60084E2F387BE5EB883F23D64945DB6AAE5E6ED7D0` | 07/03/2026 22:21:32 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `11524994DA0310AE49B292984F8FE115F67948607704AD9E7E060995EF27E3EC` | 07/03/2026 22:21:22 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `4A1BDDDB79B25B622BEBCEB3C6691B6C88CC235DF1D4829376E3BB6A6DC6845D` | 07/03/2026 22:21:07 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `5BD6B6B191542DE0B858E03E9815C9717EB94ADA3B4BDF8D965D8BDED937D5AA` | 07/03/2026 22:11:50 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `A66953D8D93CA282EB81C6AA40CA2D1C1C08BB18EB598434F30981001D461B0B` | 07/03/2026 22:08:41 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `C530DBF721EBB1B3B0B99B4B884190EB329CBDA5051EEFFA3B1F1EC21D0AADEB` | 07/03/2026 22:08:20 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `E7AA82B305BAD6B2CC496C74C298949D68CAD719AE554729D8A8154473D99C83` | 07/03/2026 22:07:27 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `791487D93210C7F21B0925D75B63CE134790B256531893C58FE43B9393DE611C` | 07/03/2026 22:07:16 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `C3EAB5184E75FD2A40A6F7CE456C262A4133D0B8E77563A6D071CA2880074DAD` | 07/03/2026 22:07:02 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `8E63CAF7C9FC5C1F94FAA1C9DBB64A5B147579CA63AA30FB71BBEBE519E6D560` | 07/03/2026 22:05:24 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `FA0249D01B9641F0C32E3204C6157033FF45C94F5317554AAE783EDA92CF9785` | 07/03/2026 22:05:14 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `4FBA021A43B0DF6420B0D558F0D6B7CC70AD4AAE77DE7E6E688AA4CEFB8F9C9C` | 07/03/2026 22:04:57 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `76C58FB9E4B0C304D5C468132B25765666B3F3E206B5A7EE037101392C8D9E46` | 07/03/2026 22:04:11 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `2F382BF1388FB068272F6C38D567F2CF52BB5F2D60EF2011C2760F7410A29A8B` | 07/03/2026 22:04:00 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `E3F57DA746B0E8AEB2534C98624A9FFBA313820728734AD1F316095039B38877` | 07/03/2026 22:03:40 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `B4E923B5697BC2C5EB08917CCE771611C73BC0D63A01024B83DC9F5AD99765F1` | 07/03/2026 22:00:09 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `3D70F72E65EC28AC844D4A1803E745EA61E702EE3807A9739BA11F11960D7E15` | 07/03/2026 21:59:59 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `62035D235A6E42989CBB8B25970DB0E46936DD491AE54C75F7FC3A221092879F` | 07/03/2026 21:59:44 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `4233A85CCA7C61FFB8FD4D0AD6BEB4BAD66ACBB71F9B6BBBE2217589FE7611BA` | 07/03/2026 21:58:39 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `31EA093B68EA06D5003369DB36C5301E7ED4F2DD846951B12F7C525E0AD4A252` | 07/03/2026 21:58:29 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `419367AD929BABA0C4D189B029A656C0071DD022232E54E264C5469FB5A9872D` | 07/03/2026 21:58:17 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `BE4B90FA996138508D8B41B2CEF06507598477B816E346A904E23F9FF59FEB9A` | 07/03/2026 21:58:11 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `049BDAF9C071797293A7B9EA3E04221C1A964697270E3B941EA1CABC8EA6FE82` | 07/03/2026 21:58:01 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `6FC6E7CDBB6BD2E14AD6E32FBD185472EFB1D79CDC158715D21CE7B70F5CAD14` | 07/03/2026 21:57:51 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `581AB72CCC1F9BBFC019B6A8A9065C554F5D71F083D86B1149F0339A68139EE9` | 07/03/2026 21:57:40 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `B107248A680CC8D2D11B708DA5BA606B77871A4FE9F91A4784CFB191974D41F3` | 07/03/2026 21:57:30 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `F139192BF91CF8CDC171D98CCDED40AE34F830DC12C0198221A1B8DC4113F644` | 07/03/2026 21:57:19 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `9A74CDA8E1F05FEDA7AFD8E1954BA5F03AE4E473A1E73D4EDB784073882125B3` | 07/03/2026 21:57:07 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `56FC7A77AC30C49C7990CA37AA53EE41C2A665A30F9AC0A2B2A35384F361C2A1` | 07/03/2026 21:56:41 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `0C78B1BD30F7236572BA1D36C6C41844007A17CE4D818291C0C59218A6AE151B` | 07/03/2026 18:02:05 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `7470C46076DE554536D1C968E00B46946EBF756F8150AD873F9E7D04B40F1FCB` | 07/03/2026 14:58:25 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `E6FC426FF9F9265812E2187A289420EC7E00E9263F46F1FCF3BBC0595F580B0A` | 07/03/2026 14:57:59 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `FAA3B11E7A25D52235169A53E5F760EAB78443BF178A1EEAD40F355F49D51018` | 07/03/2026 14:55:35 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `7680CA58B7432A32F00095DB0F8748ABD760F57287C72A34A9F680E783F9E44C` | 07/03/2026 13:54:56 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `D8BCD77C22CADF0F844E5E2C1569127DC13CC9AC6AE67C076AD876F7A76DD8CF` | 07/03/2026 13:26:22 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `34B5E5799D0B71A7AFEE5D195F0C6BCBD57BA4C9BD7E20DDFD363B5EAC659589` | 07/03/2026 13:13:28 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `B6100FDD7B600F465D44E727149842DBAF6CD7A3944B18F058BEF93A9418ACFD` | 07/03/2026 13:12:45 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `A53EDF0F3F2F9EDE3F083308BA1DBCE3224730E15ADDBC1CC29885F0722E01FC` | 07/03/2026 13:07:14 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `890BD00BD3591D6672C3EF7099D1844DEAE7F0C00DCAEF97C17328A91ED09632` | 07/03/2026 12:47:00 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `C0270BF4A76EB22D4D815B5FA3AE37E723B91F0DBAE89205CF63861A5E74A7F6` | 07/03/2026 11:42:19 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `1E00E6A83095419A457F2DE9FAD8A0E99C707B290604CFF1E9F11F1DBB2A6FE2` | 07/03/2026 09:51:54 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `F91B654FADCB37A60FE0CE64D4D2B30CA42A34F134C134B1DBBD79748968B4B6` | 07/03/2026 09:48:20 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `119F00F3079718DFEF162B71D0A6960A8142CEEBC13174E8ECA7AEA43B480690` | 07/03/2026 09:42:40 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `911795CF3E5D94CA48C787394B581F7AE3C7052DC6792D0753ECB259E75FC31E` | 07/03/2026 09:39:43 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `A1CA6EB17BD2234AEDADF7BAB578D9F2390E3DBEB000C193F731D6526C9636A2` | 07/03/2026 09:29:23 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `98242F71F775CC8F6E0A248293AE5F5CE966ED778DC30416440F84CE5B5A4B94` | 07/03/2026 09:25:45 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `85827B4936C66DCEBDFB88A7C21169A40066C9485293C98CFCAC5B3B7FAC939B` | 07/03/2026 09:18:27 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `CEAE408CB9DFEFC88523D90AC9426FACFC4DB908DF2B413485D2978AAA11E706` | 07/03/2026 09:18:17 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `C08A5C65282945FD0A4DA01A7AB5C312E3BD8083BF4F7D37E1B586636B49E32A` | 07/03/2026 09:18:06 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `709327794237C8E0A0CD54165595348A7DBAA21CF14B3533B83C7D48FE5199D8` | 07/03/2026 09:17:55 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `3ADD65697557CCE7F1E9A57F609AFE6A7DBDC6E78E5D1933C0A08069CB67212B` | 07/03/2026 09:17:43 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `98940C49E92D37E5A70EA164F2B9EF5EF89878CEF3F36AEA9E2736F6C2E266F2` | 07/03/2026 09:17:20 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `C3057ADC908DDB6AFD2C10984F745C5CEF9BA1020CEBB6CF103AAF11CEFC1FC6` | 07/03/2026 08:33:10 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `B43F6A282E1CE864314EA58F75DCCDE27332A1A2AA3DCD31A0CAB5266C90CC03` | 07/03/2026 08:33:01 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `525226D4A17B04335D2DE65B059E9A9381051155EC2EF54A4CC42D92718D18EE` | 07/03/2026 08:32:49 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `87966F39664A5DD8850ED9D02295211CCF9BDE5F3D044BDF908B3E2F965224A8` | 07/03/2026 08:32:40 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `64537E45D63910E192BFAF525F870B74EDB30EB2C43805FA3C40EF2807ECFD0C` | 07/03/2026 08:32:30 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `05B63A08C9D1485D4523606D8C534D6CA4A3F0DCF1EEBB0EE84FF607BBC3B4C5` | 07/03/2026 08:32:19 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `BC2B4689A0C36BCF9167FF41415FA2104C39EF9E7B72D09C3C286999A3C4596C` | 07/03/2026 08:32:08 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `826E7601360D37B4E40112CDA9B97CDB92E1D0F85427BD9BC465720F8854127A` | 07/03/2026 08:31:57 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `1B31768C74DB7479AC2CAD2AD7DD480847DCCE4A4E3BE91D3FF5D53A171F0439` | 07/03/2026 08:31:45 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `649D4F456A8B0FB32BE89D39E9077F3E2DAEF20E4DB1DAC485C04751E65C6ABF` | 07/03/2026 08:31:34 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `F8F73D127D23C448DD27A0D5444FF9CE4D4CDD7962A080C92C3241D459603AAC` | 07/03/2026 08:31:25 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `EFA9A1A71F628E5D5E145410D7DAA382C11530E0E718C0D4340B25E57BDE74E1` | 07/03/2026 08:30:02 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `BE8178827BA419B957FF59F1CBB7CE3B1C7BB7C5175914595D25744329E2A2F5` | 07/02/2026 11:11:21 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `FC9803410A7492BA9C014B5B14D3290F190814302419751DA64B3533B9A34663` | 07/02/2026 10:08:01 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `70F0D863FE9F51E240830A281D0E618C6D086178C28BA0C1F08E2AEF28125611` | 07/02/2026 10:07:50 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `3AA3CD7E616725A4CC4DCF5F147D55E14C0209D161B24234C80CA1F370531564` | 07/02/2026 10:06:23 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `EF92CE163FD5F62D06139FA923526E3F31D4EE6AD00BAF48DE4E91EBB92E6D23` | 07/02/2026 08:02:52 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `381EC2A48B9ECF960B24BB2DC09056A42F60FA8BDD67FBD6779DF4A7F89D181D` | 07/01/2026 13:24:06 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `EC97FD492CC6BA1C219549659B2B0F25CC5375038808F349AD2DCD001E4BA487` | 06/30/2026 18:30:51 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `0BBDFFC70BFF407CE61501C540728050D6C3B5E19C3F3F665C7D460027DC7287` | 06/30/2026 15:06:28 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `2670204AC4AF0E1C0EAAD5304214C8B70E5A90B8C6F3F0E45D3DBE47D23A43A4` | 06/30/2026 11:55:02 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `2339FDA1AA35CEA81781D2505F07F0068D5BBA72C8DBD53DD70EFD85FD6CFA14` | 06/30/2026 06:07:48 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `22CD3652E82928E043C23DE2142631768104CE8F1D226EAF79CA56E564B9272C` | 06/29/2026 21:34:01 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `BD0ABBF92BC8A819C7630326711AAF479B5A6252BA3C362E12EF4CEF82368BAB` | 06/29/2026 21:33:37 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `52B87687387EC329742D979DB7D122390DEC5CC3897C3A9FB9879478EE3F3C47` | 06/29/2026 07:31:27 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `FF6213C90A82CE4ABD871B87BAF3DA9A295071BCE056E0528C90ED319C88FCB1` | 06/28/2026 22:28:15 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `F3DDD6CA3B2683619C56BCEACF27CB5098189D0547D5400BF615BD302A120AB9` | 06/28/2026 22:28:05 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `BAB10F20416189C02EAFF1192201B7E80E1EA3C56EB1DC00BDAD97DDB79CBB77` | 06/28/2026 22:27:48 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `2A1EEF8209E18D6061C82AC089BFB9A1D8FDBEB3A84D310B7020ABC8690708E5` | 06/28/2026 15:13:25 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `2810DF0520304B6F347ED535D4D39D3F7617E216FC7E453953D3CF654FA99CA4` | 06/28/2026 11:05:10 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `45E7CF3CF5D5CD7DB3E38D469325B5FD88B049365E749CB8A0E5EDDACDC4333E` | 06/27/2026 15:32:42 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `DC30E59BA8478D522B344BA7B1D19209FB734E937ED20CE03D59BA919560591D` | 06/26/2026 21:13:43 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `E7B80B8DFAC0F8B8B718B9971B3782AF45A36023FB12DAC9575E1B82BB33DA78` | 06/26/2026 16:17:27 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `C75EC1E99C51F0AB0B41EC54A1C952DA0CA4DB2BC88382DBB9C11D11A5AEC13E` | 06/26/2026 15:15:22 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `E84ED87CC7185935375AEB31FF6F89FDABDEE31E52F07E8EFB237A0F89FE3ADF` | 06/26/2026 08:20:52 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `01531A6619DDB637E2B126806FC0FE33E02C8C6E61AF7D3499B8323C3AF1E2E8` | 06/25/2026 18:21:55 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `C7ED4FEFD959A312B6A9F5DDEDD76A24747402C53F4D74D95CB8774CA7B14E91` | 06/23/2026 22:52:24 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `31E8756B3CC14C36D78C5A05954E09F9CB2064841AA8EEF5F2E3B1F7847A3969` | 06/23/2026 16:05:20 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `F40002CA3393E8FC0D1FBF9D55B16F3753563B42A5E23D9E8D5E1A6844C8A1D0` | 06/22/2026 12:36:09 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `150486F66851FDD849BD25AC64E87497FA973B35CF838A67B1F9CC52CB2274FC` | 06/22/2026 10:29:29 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `EE6D5F200B98CB271C031BB9CC677C15F31D3F559565EDAE1D28D2A58A7D7E98` | 06/21/2026 19:41:52 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `AACAA614141743B1FA11614A3309694E1907D713B5CC1112CF0741719155049A` | 06/21/2026 19:07:45 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `8CCD86AA36110724E1312255C466BC64265380521B283B935B16DDC56C5C5244` | 06/21/2026 17:45:39 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `4585EBD596AD1D77B52055B27850D1097B04720F33D0FBFF85C2C93BAF64E51E` | 06/21/2026 14:06:28 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `378C629A1F361E38A6FCA5BFBD2A28A8D0AFC7C8BC99BAA3842F8C98B3F68C50` | 06/21/2026 09:24:12 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `66026FBC016280F8B659316F7F60BDB865AA24B02642BF769617499F28C2DCDA` | 06/21/2026 09:22:17 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `8644A308A37A4127D76CEFDD9FEE12C86ADE9F288D44A5FC4195D7893391C4CF` | 06/21/2026 09:22:02 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `AD9DA3DF225F2E654CEB571729B0C66683E0A786DB50B02F803BA7A688A03ED2` | 06/21/2026 09:21:33 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `3439FE4C2323130C4E6E5960940B4CB1DE891C3DDFE753201FCAF88787927D2A` | 06/21/2026 09:21:07 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `574B9B85D9BE48726FF5BE63376D011ECABE19041E4EAA0A9EE6CD7F7893D6A0` | 06/21/2026 00:46:02 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `A7BE0B2C835228A169E8D2CC7B5BBF267A48433D7EDD50AAF9F365D3FB457420` | 06/20/2026 18:41:02 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `1BC3E0749521CD31C76F96AEB8102BC040781EA33C713B307B13D200D35A69E2` | 06/20/2026 10:16:55 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `2CF5916E518EDFD44AF034B9DC8A8EB6503470D1F8400E1B361C5251BBC2431C` | 06/19/2026 21:28:08 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `E4518DF6116AE92CB187DB0EE2E75BF13F14356035456F18B5EC68986B2B5C46` | 06/19/2026 19:02:55 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `81EE7297A161BB576E24E6F3B924DF279CEAF88874093438F90A563D33A2754E` | 06/19/2026 15:42:18 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `47D7881E5122151C06262AB3F4280D4FE27C89C8C1B5CC282D1AE39C243668F7` | 06/19/2026 00:20:52 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `241F287499AB656EFADAA95114CBB37A604C5751EF786BE11CC441333A7F53DF` | 06/17/2026 10:43:41 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `A78F11E234A359551B25277B829EAAEE9B709601318753AF65A245AB052ECB45` | 06/17/2026 10:19:55 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `3CBF62E95A811B01AE87CD652E98E42F2C078DB7D8516AB409A0607DEF1FD20E` | 06/17/2026 07:27:09 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `8BAC03B12BAC181668358294B56768000FD4D726A462F56369BC67A5141CE208` | 06/17/2026 06:52:45 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `A4D508001B29ACE6FECC9E04016F95DC8C293E000C4D572EA057E10DCB003FDC` | 06/17/2026 05:08:09 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `ABD4C6FA4DBC98BE0F4A3BB6DD0C526BB38FBF7DD4021B89D33C3752F771267E` | 06/16/2026 15:05:15 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `369832110D60BF8B8C0246732E7D0F857C7CD6E5FC982117C109E7DF756AD3C7` | 06/16/2026 15:02:11 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `E5A6BD1DE9F843795CAF44C84BBFE1D7762E5E84A8816B7AD2BBC54D7334F6E6` | 06/15/2026 17:17:31 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `F13A7E6BD2F7582EB4F263561AD7BB7BB9838C63C3B37E4D3F376DFE50AEEC81` | 06/15/2026 07:00:16 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `8FDE0E7B8776759791B2172FA46C108D60934B634588737B41AB715CC84256DF` | 06/14/2026 11:46:43 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `4A7F359DDCBFD592D48BFC61CB25B60B4325D134F33C58D6014C198236B4577F` | 06/13/2026 22:32:28 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `667D854E56C20F04CA1C4E2274F7F08D02709711A525F0EC5A68A559B9E22DC8` | 06/12/2026 22:31:30 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `446DDC4D4AA9A717F6521EA16D6BD934265F4F97AA0E5A97353BF60B680B3C1D` | 06/12/2026 19:23:35 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `373DF92BA8246CEB472C528AE0300E792C1C64F7E81B16441737FA8D9DABE507` | 06/12/2026 05:47:58 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `A24465E08AD525499EC20FDE5356A0B29EC727108666F83D3FB4A6B9F5D7AEAF` | 06/11/2026 19:55:40 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `1A8CBD92C2EE60441A2210DB29B512E758BABECC79847E42C38BF215AF53589B` | 06/11/2026 13:46:36 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `D39A5655A1BA8F8B60EF9739B03A6B99CED601145DCB7C52916CD79736F1DC9C` | 06/11/2026 06:55:13 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `3710C4436800DD5535791BD16E49EE1C565FF5AE82AD743787E17A2787E95BB7` | 06/11/2026 02:39:17 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `F2D2324AFFA973AED45763AE60A6CA8BD8B24CF5C41A175DA686F1256597B590` | 06/10/2026 15:44:47 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `12829D936A52FFC024FC61AEB4276B7E1DC48F289996284F191CD41FBF1896C5` | 06/10/2026 12:21:12 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `C8B82C65E7ECBA09DC8A682E5DAE9926C58DDC9A5374E76DF8826CC93276A6D0` | 06/10/2026 08:02:12 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `DBEF35B69C58C9A892034E6232E75C31F48325EF0F225ED65F8669323E4049D3` | 06/10/2026 08:01:41 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `C11104C283AD29DD6FCFC732137D29D32CAD852E4D307300ED30A6F18CDAB2BC` | 06/10/2026 08:01:08 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `ACBF77F7950DF8FAFC1DCE606DA560E6EE7F48568CE86CAC2606EE98E7BBCF51` | 06/10/2026 07:10:33 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `D5AA5C31F19B79A12A7ABD7ABAF335EA186D374FA828CFA7D94FEFEA7383B77C` | 06/10/2026 01:37:22 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `09EF17DD78400184792AA35A27910BD3313A8A89FD57BC7C5121CDFE281C5D97` | 06/09/2026 21:24:52 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `AC8560A2B8F26783F43955B281292CC23FF48220FB1BF2C8DDB53D807097ABC7` | 06/09/2026 20:57:17 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `C877750AEC60770E49B46BCA961D17429B6082AA8F12D732C8688196B141781C` | 06/09/2026 13:13:50 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `5F3B69311396B9C0E7DE4185815F3BA3581B4F07B07E175371E5B9615F6CC179` | 06/09/2026 08:50:23 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `E4C5CFD6E57154C71D037D0A157BB8607A6732C7E1B9CF6671E49D39CE459C4C` | 06/09/2026 07:27:42 | MURF has no price data. In CSV, needs a custom asset and a manual price |
| `D7459657AB1ECC4D36621E4EC6B4931590D343BDC7456B95AD9052BB8C82055B` | 06/09/2026 07:27:32 | MURF has no price data. In CSV, needs a custom asset and a manual price |

_…and 1790 more of the same kind._

## balance entries present but net change is zero for every token  (10)

These staples touched your balance but netted to exactly zero across every token. They are excluded because there is no gain or loss to report, but they are listed here rather than dropped silently, so nothing disappears without being accounted for.

| Staple hash | Date (UTC) | Detail |
|---|---|---|
| `7E1904817574BBFE65699CADAD05D2ED17FA4E24A58A50B5DA583CBB3AFFE210` | 05/17/2026 01:43:45 | 1 token(s) touched, net zero |
| `70E1D6F7271DACD7830E3EA6ED095F3F0B1FF5D277B2161B7962FB6B39395806` | 05/02/2026 20:32:26 | 1 token(s) touched, net zero |
| `78E3CE726393D0547DC3092F4F53C9C3AF3C6A13C78B5B54682FA67BAE26BDA3` | 03/16/2026 11:54:35 | 1 token(s) touched, net zero |
| `3DE43BC5BF091CD004F9BBA7E4A88573FBBD1EFF3E53D71EF0FBA615F76CDF12` | 03/16/2026 11:54:08 | 1 token(s) touched, net zero |
| `8DD4C44A97A5E499322722A1386F077A441D199245924B48534F738F63070785` | 03/16/2026 11:53:42 | 1 token(s) touched, net zero |
| `B9BEB8119D24C0FD3F9D8009B4181A726AA1A822330B761EFE417249FF5A0DB7` | 03/02/2026 18:14:20 | 1 token(s) touched, net zero |
| `24FA68A62337B3B603D8C80360243257F5FD16A7618BB64EFA800F727F6C42CC` | 02/05/2026 12:27:59 | 1 token(s) touched, net zero |
| `146630CEE59DCB860D9934355932DCC8231CDD41752E7DFDBBDF68475DE25098` | 01/12/2026 13:04:40 | 1 token(s) touched, net zero |
| `051D34E49E411374677EB7D6B4EF5ED5F6CCEE7FCE9E39A0DDFB84A1AAF98C1B` | 01/09/2026 21:59:34 | 1 token(s) touched, net zero |
| `0F9A66FCFAF659729255CD874F56FD7CBFFF7EEDAB3D7E2675F6D7CC2A44A104` | 01/09/2026 20:58:37 | 1 token(s) touched, net zero |

