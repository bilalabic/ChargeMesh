// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

import {ChargeMeshEscrow} from "../src/ChargeMeshEscrow.sol";

/// @notice Deploys ChargeMeshEscrow and writes deployments/<chainId>.json.
/// @dev Env: DEPLOYER_PRIVATE_KEY (testnet/local only), SETTLER_ADDRESS (optional, defaults to deployer).
///      The deployer becomes the owner.
///      forge script script/Deploy.s.sol --rpc-url <RPC_URL> --broadcast
contract Deploy is Script {
    function run() external returns (ChargeMeshEscrow escrow) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        // Empty or unset SETTLER_ADDRESS => the deployer is also the settler (hackathon default).
        string memory settlerEnv = vm.envOr("SETTLER_ADDRESS", string(""));
        address settler = bytes(settlerEnv).length == 0 ? deployer : vm.parseAddress(settlerEnv);

        // Lower bound for indexers: the deployment tx is mined in this block or a later one.
        uint256 deployBlock = block.number;

        vm.startBroadcast(deployerKey);
        escrow = new ChargeMeshEscrow(deployer, settler);
        vm.stopBroadcast();

        console2.log("ChargeMeshEscrow:", address(escrow));
        console2.log("owner:", deployer);
        console2.log("settler:", settler);

        // Do not write deployment files for simulation-only runs (no --broadcast).
        if (vm.isContext(VmSafe.ForgeContext.ScriptDryRun)) {
            console2.log("dry run: deployments file not written");
            return escrow;
        }

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "escrow", address(escrow));
        vm.serializeAddress(key, "settler", settler);
        string memory out = vm.serializeUint(key, "deployBlock", deployBlock);

        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(out, path);
        console2.log("wrote", path);
    }
}
