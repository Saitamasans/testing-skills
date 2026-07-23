// DIFF:D01 Android UI only accepts 1..99 although the requirement is 0..100.
fun acceptsShare(value: Int) = value in 1..99

// DIFF:D12 Android reads error_msg while the API returns message.
data class ApiError(val error_msg: String?)
