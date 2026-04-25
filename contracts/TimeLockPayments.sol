// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Time-locked escrow payments — recipient can only claim after the sender-set unlock time
/// @notice Funds are locked until block.timestamp reaches the stored unlockTime. No refunds.
///         Each payment can only be settled once (claim only).
contract TimeLockPayments {
    struct EscrowPayment {
        address sender;
        address recipient;
        uint256 amount;
        uint256 unlockTime;
        bool claimed;
    }

    mapping(uint256 => EscrowPayment) public payments;
    mapping(address => uint256[]) public userPayments;
    uint256 public paymentCount;

    uint256 private _locked = 1;

    event PaymentCreated(
        uint256 indexed paymentId,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        uint256 unlockTime
    );
    event PaymentClaimed(uint256 indexed paymentId, address indexed recipient, uint256 amount);

    modifier nonReentrant() {
        require(_locked == 1, "Reentrancy blocked");
        _locked = 2;
        _;
        _locked = 1;
    }

    /// @notice Create a time-locked payment. `duration` is seconds from now until the recipient can claim.
    function createPayment(address recipient, uint256 duration) external payable returns (uint256 paymentId) {
        return _createPayment(recipient, duration);
    }

    /// @notice Claim a payment after the unlock time has passed (UTC block timestamp).
    function claimPayment(uint256 paymentId) external nonReentrant {
        _claimPayment(paymentId);
    }

    /// @notice Alias for claimPayment for frontend compatibility.
    function acceptPayment(uint256 paymentId) external nonReentrant {
        _claimPayment(paymentId);
    }

    function getPayment(uint256 paymentId) external view returns (EscrowPayment memory) {
        EscrowPayment memory payment = payments[paymentId];
        require(payment.sender != address(0), "Payment does not exist");
        return payment;
    }

    function getUserPayments(address user) external view returns (uint256[] memory) {
        require(user != address(0), "User cannot be zero address");
        return userPayments[user];
    }

    function _createPayment(address recipient, uint256 duration) internal returns (uint256 paymentId) {
        require(msg.value > 0, "Amount must be greater than zero");
        require(recipient != address(0), "Recipient cannot be zero address");
        require(recipient != msg.sender, "Sender and recipient must differ");
        require(duration > 0, "Duration must be greater than zero");

        paymentId = paymentCount;
        uint256 unlockTime = block.timestamp + duration;

        payments[paymentId] = EscrowPayment({
            sender: msg.sender,
            recipient: recipient,
            amount: msg.value,
            unlockTime: unlockTime,
            claimed: false
        });

        userPayments[recipient].push(paymentId);
        paymentCount += 1;

        emit PaymentCreated(paymentId, msg.sender, recipient, msg.value, unlockTime);
    }

    function _claimPayment(uint256 paymentId) internal {
        EscrowPayment storage payment = payments[paymentId];

        require(payment.sender != address(0), "Payment does not exist");
        require(msg.sender == payment.recipient, "Only recipient can claim");
        require(payment.amount > 0, "Payment not funded");
        require(!payment.claimed, "Already claimed");
        require(block.timestamp >= payment.unlockTime, "Payment is still locked");

        uint256 amount = payment.amount;

        payment.claimed = true;

        (bool success, ) = payable(payment.recipient).call{value: amount}("");
        require(success, "Transfer to recipient failed");

        emit PaymentClaimed(paymentId, payment.recipient, amount);
    }
}

